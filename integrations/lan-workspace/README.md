# Herdr LAN workspace

This macOS integration adds “公司内部登录” as a host type in this fork of
Herdr. The local launcher stages the SMB runtime and the host picker.

To open an isolated workbench:

```sh
HERDR_LAN_HOME="$HOME/Library/Application Support/Herdr LAN Workspace" \
  HERDR_LAN_BINARY="$PWD/target/release/herdr-app" \
  ./integrations/lan-workspace/launch-macos.zsh
```

Build with `cargo build --release --locked` first. The launcher uses the
forked build in a separate app bundle within the workbench profile.

The local Mac needs Herdr, `hc`, Node.js 22 or later, npm, and the macOS Swift
command-line tools. On first launch the launcher also builds the pinned SMB
helper, using a checksum-verified Go toolchain. The toolchain and SMB library
are needed on the local Mac only.

“添加主机” opens “公司内部登录” by default. Enter the remote Mac's IP address, SSH
user and port, and choose a local project. You can enter the SSH password
before saving the host. Herdr stores it in the Mac Keychain. Select the host in
“新建工作区”. Its first terminal, new tabs, and splits open on the remote Mac
in the mounted project. On the first connection, verify the SSH host
fingerprint in the embedded terminal. Herdr then uses the saved password,
associating it with the verified host key. If you leave the password
blank or the host rejects it, enter a password when prompted. With
“在这台 Mac 上记住 SSH 密码” enabled, a successful password is saved.
Use “设置 → 主机 → 编辑” to update an existing host's saved password.

Scripts can select a saved shared host with
`herdr-app do space.new --machine lan:<host-id>`. The project is taken from
the saved host so a caller cannot override it with a different folder.

The SSH server must allow loopback reverse forwarding. The remote Mac uses
its existing `mount_smbfs`. SSH and the SMB mount stay active while the
terminal runs. Only the selected project directory is shared. The SMB
filesystem excludes environment files, Git metadata, dependency folders,
symbolic links and hard links.

Remote saves write through to the Mac project directory. Type `exit` in
the remote terminal to unmount. The workspace uses whichever CLI is already
present on the remote Mac.

The SMB helper and its build and mount code are adapted from the Orca LAN
workspace prototype. See [ORCA-LICENSE](ORCA-LICENSE).
