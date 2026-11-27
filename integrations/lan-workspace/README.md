# Herdr LAN workspace

This macOS integration adds “SSH（共享目录）” as a host type in this fork of
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

In “添加主机”, choose “SSH（共享目录）”, enter the remote Mac's IP address, SSH
user and port, then choose a local project and save. Select the host in
“新建工作区”. Its first terminal, new tabs, and splits open on the remote Mac
in the mounted project. Use the embedded terminal to verify the host
fingerprint and enter an SSH password. Choosing “在这台 Mac 上记住 SSH 密码”
stores a successful password in the macOS Keychain with the endpoint and
verified host key as its identity. Later connections reuse that password;
a rejected password prompts for a new one.

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
