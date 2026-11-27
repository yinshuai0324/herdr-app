//! Start an SSH terminal into a Mac project shared by the local SMB helper.

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;
use std::process::Stdio;

const HOSTS: &str = "lan-workspace.hosts";

#[derive(Deserialize)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub directory: String,
    host: String,
    username: String,
    port: u16,
    remember: bool,
    credential: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Runtime {
    node: String,
    workspace: String,
    keychain: String,
    smb_server: String,
    state_dir: String,
}

impl Runtime {
    fn load() -> Result<Self, String> {
        let path = crate::mods::mods_dir().join("lan-workspace/runtime.json");
        std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or_else(|| "无法读取共享目录配置，请用 Herdr 局域网启动器打开。".into())
    }
}

#[derive(Deserialize)]
pub struct Address {
    host: String,
    username: String,
    port: u16,
}

#[derive(Deserialize)]
struct HostPin {
    fingerprint: String,
}

/// The secret is passed to the same Keychain helper used by the SSH terminal,
/// on stdin. Its arguments only contain the operation and an opaque account ID.
pub fn form_password(address: Address, credential: String, password: Option<String>) -> Result<(), String> {
    if !cfg!(target_os = "macos") || credential.is_empty() || credential.len() > 80 ||
        !credential.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') ||
        address.host.is_empty() || address.host.len() > 256 ||
        !address.host.bytes().all(|byte| byte.is_ascii_alphanumeric() || b":.%_-".contains(&byte)) ||
        address.username.is_empty() || address.username.len() > 64 ||
        !address.username.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)) ||
        address.port == 0
    {
        return Err("SSH 密码的主机信息无效。".into());
    }
    let runtime = Runtime::load()?;
    if !Path::new(&runtime.keychain).is_absolute() || !Path::new(&runtime.state_dir).is_absolute() {
        return Err("无法读取共享目录配置，请用 Herdr 局域网启动器打开。".into());
    }
    let endpoint = json!([address.host, address.port, address.username]).to_string();
    let key = format!("{:x}", Sha256::digest(endpoint));
    let identity = format!("{:x}", Sha256::digest(format!("form:{key}:{credential}")));
    let error = || "macOS 钥匙串操作失败。请解锁钥匙串后重试。".to_owned();
    let (action, secret) = if let Some(password) = password {
        let pin = std::path::PathBuf::from(&runtime.state_dir).join(format!("{key}.json"));
        let fingerprint = match std::fs::read(pin) {
            Ok(data) => Some(serde_json::from_slice::<HostPin>(&data).map_err(|_| "SSH 主机指纹记录无效。")?.fingerprint),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("无法读取 SSH 主机指纹记录。".into()),
        };
        let secret = json!({"password": password, "fingerprint": fingerprint}).to_string();
        if password.is_empty() || secret.len() > 8192 {
            return Err("请输入有效长度的 SSH 密码。".into());
        }
        ("save", Some(secret))
    } else {
        ("forget", None)
    };
    let mut child = crate::spawn::detached_command(&runtime.keychain)
        .args([action, identity.as_str()])
        .stdin(if secret.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_| error())?;
    let wrote = match (secret, child.stdin.take()) {
        (Some(secret), Some(mut stdin)) => stdin.write_all(secret.as_bytes()).is_ok(),
        (None, _) => true,
        _ => false,
    };
    let status = child.wait().map_err(|_| error())?;
    if wrote && status.success() { Ok(()) } else { Err(error()) }
}

pub fn target_id(target: &str) -> Option<&str> {
    target.strip_prefix("lan:")
}

pub fn available() -> bool {
    cfg!(target_os = "macos") && Runtime::load().is_ok()
}

fn hosts() -> Vec<Host> {
    let Some(Value::Array(rows)) = crate::mods::shared(HOSTS) else {
        return Vec::new();
    };
    rows.into_iter().filter_map(|row| serde_json::from_value(row).ok()).collect()
}

pub fn has_hosts() -> bool {
    !hosts().is_empty()
}

pub fn host(id: &str) -> Result<Host, String> {
    hosts().into_iter().find(|host| host.id == id)
        .ok_or_else(|| "找不到该公司内部主机。".into())
}

impl Host {
    pub fn launch(&self, argv: Option<Vec<String>>, task: Option<&str>) -> Result<Vec<String>, String> {
        let runtime = Runtime::load()?;
        if !cfg!(target_os = "macos") ||
            [&runtime.node, &runtime.workspace, &runtime.keychain, &runtime.smb_server, &runtime.state_dir, &self.directory]
                .iter().any(|path| !Path::new(path).is_absolute())
        {
            return Err("公司内部登录需要有效的 Mac 本机目录和运行配置。".into());
        }
        let mut remote = argv.unwrap_or_default();
        if !remote.is_empty() {
            remote.extend(task.map(str::trim).filter(|task| !task.is_empty()).map(str::to_owned));
            remote = crate::remote_shell::launch(remote);
        }
        let config: Value = json!({
            "host": self.host, "username": self.username, "port": self.port,
            "directory": self.directory, "remember": self.remember, "credential": self.credential, "argv": remote,
            "keychain": runtime.keychain, "smbServer": runtime.smb_server, "stateDir": runtime.state_dir,
        });
        Ok(vec![runtime.node, runtime.workspace, config.to_string()])
    }
}
