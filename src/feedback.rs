//! Explicit, person-reviewed beta feedback. No usage-data consent or install id.
//! Screenshots are what the person pastes or picks, each shown before sending.
use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_IMAGES: usize = 3;
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

const ENDPOINT: &str = "https://telemetry.herdr.dev/v1/feedback";
const FEISHU_HOOK: &str = "https://open.feishu.cn/open-apis/bot/v2/hook/";

#[derive(Deserialize, Serialize)]
struct Webhook {
    url: String,
    signing_secret: String,
}

pub fn direct() -> bool { cfg!(target_os = "macos") && crate::update::is_duodian() }

fn is_webhook_url(url: &str) -> bool {
    url.strip_prefix(FEISHU_HOOK).is_some_and(|id| (16..=128).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

fn read_webhook() -> Result<Option<Webhook>, String> {
    crate::lan_workspace::feedback_keychain("get", None)?.map(|data| {
        let webhook: Webhook = serde_json::from_slice(&data).map_err(|_| "飞书机器人配置无效，请重新设置。")?;
        if !is_webhook_url(&webhook.url) {
            return Err("飞书机器人配置无效，请重新设置。".into());
        }
        Ok(webhook)
    }).transpose()
}

pub fn configure_webhook(action: &str, url: &str, signing_secret: &str) -> Result<bool, String> {
    match action {
        "status" => Ok(read_webhook()?.is_some()),
        "save" => {
            if !is_webhook_url(url.trim()) || signing_secret.len() > 256 {
                return Err("请填写有效的飞书群自定义机器人 Webhook。".into());
            }
            let webhook = Webhook { url: url.trim().into(), signing_secret: signing_secret.trim().into() };
            let value = serde_json::to_string(&webhook).map_err(|_| "无法保存飞书机器人配置。")?;
            crate::lan_workspace::feedback_keychain("save", Some(&value))?;
            Ok(true)
        }
        "forget" => {
            crate::lan_workspace::feedback_keychain("forget", None)?;
            Ok(false)
        }
        _ => Err("未知的飞书机器人配置操作。".into()),
    }
}

fn endpoint() -> Option<String> {
    std::env::var("HERDR_FEEDBACK_URL").ok().filter(|u| !u.is_empty())
        .or_else(|| option_env!("HERDR_APP_RELEASE").map(|_| ENDPOINT.to_owned()))
}

pub fn draft(message: &str, email: &str, images: usize, from: &str, layout: &str) -> Value {
    json!({
        "v": 1,
        "from": if from == "agent" { "agent" } else { "person" },
        "message": message.trim(),
        "email": if email.trim().is_empty() { None } else { Some(email.trim()) },
        "app": {
            "version": crate::APP_VERSION,
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "channel": "stable",
        },
        "core": { "version": crate::update::core().version.as_deref().map(crate::telemetry::version) },
        "layout": if crate::window::shipped_layouts().contains(&layout) { layout } else { "other" },
        "images": images,
    })
}

/// Where the form keeps the screenshots it shows (its data folder: `image()` reads from the app home).
fn shots_dir() -> PathBuf { crate::mods::app_dir().join("data").join("frame-feedback") }

fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Some("png") }
    else if bytes.starts_with(&[0xff, 0xd8, 0xff]) { Some("jpg") }
    else { None }
}

/// Keeps a pasted or picked image for the form: PNG or JPEG as is, any other
/// image as PNG. Returns its path from the app home.
pub fn attach(bytes: &[u8]) -> Result<String, String> {
    let (bytes, ext) = match sniff(bytes) {
        Some(ext) => (bytes.to_vec(), ext),
        None => {
            let img = image::load_from_memory(bytes).map_err(|_| "That isn't an image Herdr can read.".to_owned())?;
            let mut png = std::io::Cursor::new(Vec::new());
            img.write_to(&mut png, image::ImageFormat::Png).map_err(|_| "Couldn't convert that image.".to_owned())?;
            (png.into_inner(), "png")
        }
    };
    if bytes.len() > MAX_IMAGE_BYTES { return Err("That image is over 5 MB.".into()); }
    let dir = shots_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let name = format!("shot-{stamp}.{ext}");
    std::fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("data/frame-feedback/{name}"))
}

/// Picker and external drops share the same conversion and size limits.
pub fn attach_files(paths: &[PathBuf]) -> Vec<Value> {
    paths.iter().take(MAX_IMAGES).map(|p| {
        match std::fs::read(p) {
            Ok(bytes) => match attach(&bytes) {
                Ok(path) => json!({ "path": path }),
                Err(error) => json!({ "error": error }),
            },
            Err(_) => json!({ "error": "Couldn't read that file." }),
        }
    }).collect()
}

/// Drops the form's screenshots (a new form starts empty; a sent one is done with them).
pub fn clear_shots() {
    let Ok(entries) = std::fs::read_dir(shots_dir()) else { return };
    for e in entries.flatten() {
        if e.file_name().to_string_lossy().starts_with("shot-") { let _ = std::fs::remove_file(e.path()); }
    }
}

/// A path `attach` returned, checked again before it leaves the machine.
fn shot_file(rel: &str) -> Result<PathBuf, String> {
    let name = rel.strip_prefix("data/frame-feedback/").filter(|n| n.starts_with("shot-") && !n.contains(['/', '\\']))
        .ok_or("Unknown screenshot.")?;
    let path = shots_dir().join(name);
    let bytes = std::fs::read(&path).map_err(|_| "A screenshot is gone. Remove it and add it again.".to_owned())?;
    if bytes.len() > MAX_IMAGE_BYTES || sniff(&bytes).is_none() { return Err("A screenshot isn't a PNG or JPEG under 5 MB.".into()); }
    Ok(path)
}

pub fn available() -> bool { !direct() && endpoint().is_some() }

fn validate(body: &Value) -> Result<(), String> {
    let message = body["message"].as_str().unwrap_or_default();
    if message.is_empty() { return Err("Write a message first.".into()); }
    if message.encode_utf16().count() > 4000 { return Err("Keep the message to 4000 characters.".into()); }
    if let Some(email) = body["email"].as_str() {
        let valid = email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.split_once('.').is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
                && !domain.contains('@')
        });
        if email.len() > 254 || !valid || email.chars().any(char::is_whitespace) {
            return Err("Enter a plain email address, or leave it blank.".into());
        }
    }
    Ok(())
}

pub async fn send(body: Value, shots: Vec<String>) -> Result<(), String> {
    validate(&body)?;
    if shots.len() > MAX_IMAGES || body["images"].as_u64() != Some(shots.len() as u64) {
        return Err("Up to 3 screenshots.".into());
    }
    let direct = direct();
    if direct && !shots.is_empty() { return Err("飞书群自定义机器人接收文字反馈。".into()); }
    let (tx, rx) = async_channel::bounded(1);
    std::thread::spawn(move || {
        let result = if direct {
            read_webhook().and_then(|webhook| {
                let webhook = webhook.ok_or("请先配置飞书群机器人。")?;
                post_webhook(&webhook, &body)
            })
        } else {
            endpoint().ok_or_else(|| "This build was made from source and doesn't send feedback. Use a release build.".into())
                .and_then(|url| {
                    let files = shots.iter().map(|shot| shot_file(shot)).collect::<Result<Vec<_>, _>>()?;
                    post(&url, &body.to_string(), &files)
                })
        };
        if result.is_ok() { clear_shots(); }
        let _ = tx.send_blocking(result);
    });
    rx.recv().await.map_err(|_| "The feedback request was lost.".to_owned())?
}

fn webhook_payload(feedback: &Value, signing_secret: &str, unix_time: u64) -> Value {
    let mut paragraphs = vec![json!([{ "tag": "text", "text": feedback["message"] }])];
    paragraphs.push(json!([{ "tag": "text", "text": format!("客户端 {} / {}", crate::APP_VERSION, std::env::consts::OS) }]));
    if let Some(email) = feedback["email"].as_str() {
        paragraphs.push(json!([{ "tag": "text", "text": format!("联系邮箱 {email}") }]));
    }
    let mut payload = json!({
        "msg_type": "post",
        "content": { "post": { "zh_cn": { "title": "多点终端反馈", "content": paragraphs } } },
    });
    if !signing_secret.is_empty() {
        let timestamp = unix_time.to_string();
        let signing_key = format!("{timestamp}\n{signing_secret}");
        let mac = Hmac::<Sha256>::new_from_slice(signing_key.as_bytes()).expect("HMAC accepts any key length");
        payload["timestamp"] = json!(timestamp);
        payload["sign"] = json!(STANDARD.encode(mac.finalize().into_bytes()));
    }
    payload
}

fn curl_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn post_webhook(webhook: &Webhook, feedback: &Value) -> Result<(), String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "请检查本机日期和时间。")?;
    let payload = webhook_payload(feedback, &webhook.signing_secret, now.as_secs());
    // The URL includes a credential. Keep it out of the process listing and
    // use curl's stdin for both the URL and the escaped JSON payload.
    let config = format!("url = {}\ndata-binary = {}\n", curl_quote(&webhook.url), curl_quote(&payload.to_string()));
    let args = ["--disable", "--config", "-", "-sS", "--proto", "=https", "--max-time", "20",
        "--max-filesize", "65536", "-X", "POST", "-H", "Content-Type: application/json", "-w", "\n%{http_code}"];
    let response = curl(&args, &config, "无法连接飞书，请检查网络后重试。")?;
    read_webhook_response(&response)
}

fn read_webhook_response(response: &[u8]) -> Result<(), String> {
    let response = String::from_utf8_lossy(response);
    let (body, status) = response.rsplit_once('\n').ok_or("飞书返回异常，请稍后重试。")?;
    let reply: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let code = reply["code"].as_i64().or_else(|| reply["StatusCode"].as_i64());
    match (status, code) {
        ("200", Some(0)) => Ok(()),
        (_, Some(19021)) => Err("飞书拒绝了签名，请核对机器人签名密钥和本机时间。".into()),
        (_, Some(19024)) => Err("反馈未通过飞书机器人的关键词校验。".into()),
        (_, Some(19022)) => Err("飞书机器人的 IP 白名单未允许本机网络。".into()),
        ("429", _) => Err("发送较频繁，请稍后重试。".into()),
        _ => Err("飞书未接收反馈，请核对机器人配置后重试。".into()),
    }
}

/// Text alone goes as JSON (what every version sends); with screenshots, as a
/// form: the same JSON in `feedback`, each image in `image`.
fn post(url: &str, body: &str, files: &[PathBuf]) -> Result<(), String> {
    let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let mut args: Vec<String> = ["-sS", "--max-time", "60", "-X", "POST"].map(String::from).to_vec();
    if files.is_empty() {
        args.extend(["-H", "content-type: application/json", "--data-binary", "@-"].map(String::from));
    } else {
        args.extend(["-F".into(), "feedback=<-;type=application/json".into()]);
        for f in files {
            let kind = if f.extension().is_some_and(|e| e == "png") { "image/png" } else { "image/jpeg" };
            args.extend(["-F".into(), format!("image=@{};type={kind}", f.display())]);
        }
    }
    args.extend(["-o", null, "-w", "%{http_code}", url].map(String::from));
    let output = curl(&args, body, "Couldn't reach the feedback server. Check your connection and try again.")?;
    match String::from_utf8_lossy(&output).trim() {
        "204" => Ok(()),
        "429" => Err("Too many, try in a minute.".into()),
        "503" => Err("Not taking feedback right now. Try again later.".into()),
        "400" => Err("The server couldn't accept this feedback. Check the message and email.".into()),
        "413" => Err("The feedback is too large. Shorten the message or remove a screenshot.".into()),
        _ => Err("The feedback server returned an unexpected answer. Try again later.".into()),
    }
}

fn curl(args: &[impl AsRef<std::ffi::OsStr>], input: &str, network: &str) -> Result<Vec<u8>, String> {
    let mut child = crate::spawn::command(crate::update::system("curl"))
        .args(args)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| network)?;
    if child.stdin.take().ok_or(network)?.write_all(input.as_bytes()).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(network.into());
    }
    let out = child.wait_with_output().map_err(|_| network)?;
    if out.status.success() { Ok(out.stdout) } else { Err(network.into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn payload_is_text_only_and_custom_layouts_are_hidden() {
        let body = draft("  broken  ", "  ", 2, "agent", "private-layout");
        assert_eq!(body["message"], "broken");
        assert_eq!(body["email"], Value::Null);
        assert_eq!(body["from"], "agent");
        assert_eq!(body["layout"], "other");
        assert_eq!(body["images"], 2);
        assert_eq!(body.as_object().unwrap().len(), 8);
        assert!(body.get("install").is_none());
        assert_eq!(draft("ok", "a@b.c", 0, "person", "main")["layout"], "main");
    }
    #[test]
    fn invalid_message_and_email_are_explained() {
        for (message, email) in [("", ""), (&"x".repeat(4001), ""), ("ok", "bad"), ("ok", "a b@c.d")] {
            assert!(validate(&draft(message, email, 0, "person", "main")).is_err());
        }
        assert!(validate(&draft("ok", "a@b.c", 0, "person", "main")).is_ok());
    }
    #[test]
    fn only_png_and_jpeg_leave_as_they_are() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(sniff(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(sniff(b"GIF89a"), None);
        assert!(shot_file("data/frame-feedback/../../settings.json").is_err());
        assert!(shot_file("/etc/passwd").is_err());
    }

    #[test]
    fn feishu_webhook_requires_the_exact_https_host_and_path() {
        assert!(is_webhook_url("https://open.feishu.cn/open-apis/bot/v2/hook/test-fixture-1234567890"));
        for url in [
            "http://open.feishu.cn/open-apis/bot/v2/hook/test-fixture-1234567890",
            "https://open.feishu.cn.evil.example/open-apis/bot/v2/hook/test-fixture-1234567890",
            "https://open.feishu.cn/open-apis/bot/v2/hook/test-fixture-1234567890?secret=1",
        ] {
            assert!(!is_webhook_url(url), "{url}");
        }
    }

    #[test]
    fn feishu_payload_preserves_text_and_signs_the_timestamp() {
        let message = "路径 \"C:\\temp\"\n<at user_id=\"all\">";
        let draft = draft(message, "test@example.com", 0, "person", "main");
        let payload = webhook_payload(&draft, "fixture-signing-key", 1_700_000_000);
        assert_eq!(payload["timestamp"], "1700000000");
        assert_eq!(payload["sign"], "tGzzuWM2YMs4FJ4yC11q4F0OBCSucEt6n9rn7jFsU+U=");
        let text = &payload["content"]["post"]["zh_cn"]["content"][0][0];
        assert_eq!(text, &json!({ "tag": "text", "text": message }));
        let encoded = payload.to_string();
        assert_eq!(serde_json::from_str::<String>(&curl_quote(&encoded)).unwrap(), encoded);
    }

    #[test]
    fn feishu_success_requires_a_successful_api_code() {
        assert!(read_webhook_response(b"{\"code\":0}\n200").is_ok());
        assert!(read_webhook_response(b"{\"StatusCode\":0}\n200").is_ok());
        assert!(read_webhook_response(b"{\"code\":0}\n500").is_err());
        assert!(read_webhook_response(b"{\"code\":19021}\n200").unwrap_err().contains("签名"));
    }
}
