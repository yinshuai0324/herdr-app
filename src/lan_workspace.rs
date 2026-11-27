//! Start an SSH terminal into a Mac project shared by the local SMB helper.

use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;

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

pub fn target_id(target: &str) -> Option<&str> {
    target.strip_prefix("lan:")
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
        .ok_or_else(|| "找不到该共享目录主机。".into())
}

impl Host {
    pub fn launch(&self, argv: Option<Vec<String>>, task: Option<&str>) -> Result<Vec<String>, String> {
        let path = crate::mods::mods_dir().join("lan-workspace/runtime.json");
        let runtime: Runtime = std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or("无法读取共享目录配置，请用 Herdr 局域网启动器打开。")?;
        if !cfg!(target_os = "macos") ||
            [&runtime.node, &runtime.workspace, &runtime.keychain, &runtime.smb_server, &runtime.state_dir, &self.directory]
                .iter().any(|path| !Path::new(path).is_absolute())
        {
            return Err("共享目录主机需要在 Mac 上使用有效的本机目录和运行配置。".into());
        }
        let mut remote = argv.unwrap_or_default();
        if !remote.is_empty() {
            remote.extend(task.map(str::trim).filter(|task| !task.is_empty()).map(str::to_owned));
            remote = crate::remote_shell::launch(remote);
        }
        let config: Value = json!({
            "host": self.host, "username": self.username, "port": self.port,
            "directory": self.directory, "remember": self.remember, "argv": remote,
            "keychain": runtime.keychain, "smbServer": runtime.smb_server, "stateDir": runtime.state_dir,
        });
        Ok(vec![runtime.node, runtime.workspace, config.to_string()])
    }
}
