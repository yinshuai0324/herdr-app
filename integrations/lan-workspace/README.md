# Herdr LAN workspace

This macOS integration adds “连接并挂载本机项目” to Herdr's Command Palette
(`⌘⇧P`). It uses a personal Herdr mod and a local launcher. It runs with the
installed Herdr app and herdr-core without building Rust.

To open an isolated workbench:

```sh
HERDR_LAN_HOME="$HOME/Library/Application Support/Herdr LAN Workspace" \
  ./integrations/lan-workspace/launch-macos.zsh
```

The local Mac needs Herdr, `hc`, Node.js 22 or later, npm, and the macOS Swift
command-line tools. On first launch the launcher also builds the pinned SMB
helper, using a checksum-verified Go toolchain. The toolchain and SMB library
are needed on the local Mac only.

Choose the project folder and fill in the remote Mac's IP address, SSH port
and user. Use the terminal that opens inside the workspace to verify the
host fingerprint and enter an SSH password. Choosing “在这台 Mac 上记住 SSH 密码”
stores a successful password in the macOS Keychain with the endpoint and
verified host key as its identity. Later connections reuse that password;
a rejected password prompts for a new one.

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
