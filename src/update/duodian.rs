//! The fork's signed macOS release channel. It never uses the upstream app feed.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

mod feed;
use feed::Feed;

const BUNDLE: &str = "多点终端.app";
const IDENTIFIER: &str = "dev.herdr.lan.zh";
const CHANNEL: &str = "duodian-terminal";
const CONFIG: &str = "duodian-update.json";
const KEY: &str = "duodian-update.pem";

fn resources(root: &Path) -> PathBuf {
    root.join("Contents/Resources")
}

pub(super) fn is_install(root: &Path) -> bool {
    cfg!(target_os = "macos")
        && (root.file_name().is_some_and(|name| name == BUNDLE) || resources(root).join(CONFIG).is_file()
            || option_env!("DUODIAN_APP_VERSION").is_some())
}

#[derive(Deserialize, Eq, PartialEq)]
struct Settings {
    feed: String,
}

pub(super) struct Config {
    feed: Feed,
    key: Vec<u8>,
}

impl Config {
    fn load(root: &Path) -> Result<Self, String> {
        let resources = resources(root);
        let settings: Settings = serde_json::from_slice(&std::fs::read(resources.join(CONFIG)).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let feed = Feed::parse(&settings.feed).map_err(str::to_owned)?;
        let key = std::fs::read(resources.join(KEY)).map_err(|e| e.to_string())?;
        if key.is_empty() || key.len() > 8192 {
            return Err("多点终端更新公钥无效。".into());
        }
        Ok(Self { feed, key })
    }

    fn verify_bundle(&self, app: &Path) -> Result<(), String> {
        super::run(Command::new("/usr/bin/codesign").args(["--verify", "--deep", "--strict"]).arg(app))?;
        let plist = app.join("Contents/Info.plist");
        let out = Command::new("/usr/bin/plutil").args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
            .arg(&plist).output().map_err(|e| e.to_string())?;
        if !out.status.success() || String::from_utf8_lossy(&out.stdout).trim() != IDENTIFIER {
            return Err("下载的软件包不是多点终端。".into());
        }
        let next = Self::load(app)?;
        if self.feed != next.feed || self.key != next.key {
            return Err("下载的软件包缺少匹配的多点终端更新或启动配置。".into());
        }
        let resources = resources(app);
        for file in [
            "duodian-launch.zsh", "lan-mod/main.js", "lan-mod/mod.json",
            "lan-runtime/workspace.mjs", "lan-runtime/ssh.mjs", "lan-runtime/shell.mjs",
            "lan-runtime/lan-smb-mount.mjs", "lan-runtime/build-smb-server.mjs",
            "lan-runtime/keychain", "lan-runtime/herdr-lan-smb", "lan-runtime/node_modules/ssh2/package.json",
        ] {
            if !resources.join(file).is_file() {
                return Err(format!("下载的软件包缺少公司内部登录组件：{file}"));
            }
        }
        Ok(())
    }
}

pub(super) fn configured(root: &Path) -> bool {
    is_install(root) && Config::load(root).is_ok()
}

fn packaged(root: &Path) -> bool {
    is_install(root) && resources(root).join("duodian-launch.zsh").is_file()
}

pub(super) fn validate_stage(current: &Path, staged: &Path) -> Result<(), String> {
    Config::load(current)?.verify_bundle(staged)
}

#[derive(Deserialize)]
struct SignedRelease {
    payload: String,
    signature: String,
}

#[derive(Deserialize)]
struct Release {
    product: String,
    version: String,
    target: String,
    sha256: String,
}

fn curl() -> Command {
    let mut cmd = crate::spawn::command("/usr/bin/curl");
    cmd.args(["-fsSL", "--proto", "=https,file", "--proto-redir", "=https"]);
    cmd
}

fn valid_version(version: &str) -> bool {
    let parts: Vec<_> = version.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| {
        part.parse::<u64>().is_ok_and(|n| n.to_string() == *part)
    })
}

fn read_release(config: &Config, work: &Path) -> Result<Release, String> {
    let envelope = curl().args(["--max-time", "30", "--max-filesize", "65536"])
        .arg(config.feed.manifest_url())
        .output().map_err(|e| e.to_string())?;
    if !envelope.status.success() {
        return Err("无法读取多点终端更新源。".into());
    }
    let signed: SignedRelease = serde_json::from_slice(&envelope.stdout).map_err(|e| e.to_string())?;
    let payload = STANDARD.decode(signed.payload).map_err(|e| e.to_string())?;
    let signature = STANDARD.decode(signed.signature).map_err(|e| e.to_string())?;
    for (name, bytes) in [("payload", payload.as_slice()), ("signature", signature.as_slice()), ("public.pem", config.key.as_slice())] {
        std::fs::write(work.join(name), bytes).map_err(|e| e.to_string())?;
    }
    super::run(Command::new("/usr/bin/openssl").current_dir(work)
        .args(["dgst", "-sha256", "-verify", "public.pem", "-signature", "signature", "payload"]))
        .map_err(|_| "多点终端更新签名验证失败。".to_owned())?;
    serde_json::from_slice(&payload).map_err(|e| e.to_string())
}

pub(super) fn check(root: &Path) -> Result<Option<String>, String> {
    let config = Config::load(root)?;
    let work = super::beside(root, ".feed");
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = read_release(&config, &work);
    let _ = std::fs::remove_dir_all(work);
    let release = result?;
    if release.product != CHANNEL || !valid_version(&release.version)
        || release.sha256.len() != 64 || !release.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("多点终端更新清单无效。".into());
    }
    if release.target != super::target() || !super::newer(&release.version, crate::APP_VERSION) {
        return Ok(None);
    }
    if super::staged_version(root).as_deref() == Some(&release.version) {
        return Ok(Some(release.version));
    }
    let url = config.feed.archive_url(&release.version, &release.target);
    super::stage(root, &release.version, &url, &release.sha256, Some(&config))
}

pub(super) fn unpack(url: &str, sha: &str, work: &Path, config: &Config) -> Result<PathBuf, String> {
    let tarball = work.join("app.tar.gz");
    super::run(curl().args(["--max-time", "600", "--max-filesize", "536870912", "-o"]).arg(&tarball).arg(url))?;
    let bytes = std::fs::read(&tarball).map_err(|e| e.to_string())?;
    if super::sha256(&bytes) != sha.to_ascii_lowercase() {
        return Err("多点终端安装包校验失败。".into());
    }
    super::run(Command::new("/usr/bin/tar").arg("-xzf").arg(&tarball).arg("-C").arg(work))?;
    let app = work.join(BUNDLE);
    config.verify_bundle(&app)?;
    Ok(app)
}

/// Keep the existing profile when LaunchServices opens a replaced bundle.
pub fn init_duodian_home() {
    let Some(root) = super::root().filter(|root| packaged(root)) else { return };
    if std::env::var_os("HERDR_APP_HOME").is_some_and(|value| !value.is_empty()) { return; }
    let installed = root.parent().filter(|parent| parent.join("core-config").is_dir());
    let profile = installed.map(Path::to_path_buf)
        .unwrap_or_else(|| crate::mods::home().join("Library/Application Support/Herdr LAN Workspace"));
    // SAFETY: called once before any app threads start.
    unsafe { std::env::set_var("HERDR_APP_HOME", profile) };
}

pub fn prepare_duodian_launch() -> Result<(), String> {
    let Some(root) = super::root().filter(|root| packaged(root)) else { return Ok(()) };
    let profile = crate::mods::app_dir();
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    let profile = profile.canonicalize().map_err(|e| e.to_string())?;
    let id = super::sha256(profile.as_os_str().as_encoded_bytes());
    let session = format!("herdr-lan-{}", &id[..16]);
    let socket_dir = Path::new("/private/tmp").join(&session);
    // SAFETY: the app has not started the core or any app threads.
    unsafe {
        std::env::set_var("HC_SESSION", session);
        std::env::set_var("HC_SOCKET", socket_dir.join("core.sock"));
        std::env::set_var("XDG_CONFIG_HOME", profile.join("core-config"));
        std::env::set_var("XDG_STATE_HOME", profile.join("core-state"));
        std::env::set_var("HERDR_TELEMETRY", "off");
    }
    super::run(Command::new("/bin/zsh").arg(resources(&root).join("duodian-launch.zsh"))
        .arg(profile).arg(socket_dir))
}
