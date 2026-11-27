# 多点终端 LAN workspace

This macOS integration adds “公司内部登录” as a host type in this fork of
Herdr. The local launcher stages the SMB runtime and the host picker.

To open an isolated workbench:

```sh
HERDR_LAN_HOME="$HOME/Library/Application Support/Herdr LAN Workspace" \
  HERDR_LAN_BINARY="$PWD/target/release/herdr-app" \
  ./integrations/lan-workspace/launch-macos.zsh
```

Build with `cargo build --release --locked` first. The launcher uses the
forked build as `多点终端.app` within the workbench profile.

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

## 多点终端更新源

发布脚本在 Apple Silicon Mac 上从当前源码构建并签名。每次发布使用比上次更高的三段数字版本号。版本号由发布脚本传入应用，独立于上游的 Cargo 版本。

```sh
integrations/lan-workspace/publish-macos.zsh <版本号> <更新源目录> <签名私钥路径>
```

首次发布先用 `openssl ecparam -name prime256v1 -genkey -noout` 创建签名私钥，并以当前用户私有的权限保管。发布脚本把公钥放进应用。请用同一把私钥签后续版本。

不传第四个参数时，安装包绑定本机目录。当前工作台使用
`~/Library/Application Support/Herdr LAN Workspace/update-feed`。
如需内网共享，首次为该通道打包时传入静态站点的 HTTPS 根地址作为第四个参数。先上传
`app/<版本号>/` 内的安装包，再发布 `app/latest.json`。私钥留在发布机。

公开下载也可以用 GitHub Releases。打包时将 `https://github.com/所有者/仓库` 作为第四个参数，
再把 `app/<版本号>/` 中的 `duodian-latest.json` 和
`duodian-macos-aarch64.tar.gz` 一起上传到 `v<版本号>` 的正式 Release。
切换来源时，首次安装绑到 GitHub 仓库的签名包，原工作台配置目录与签名私钥沿用。

推送到 `yinshuai0324/herdr-app` 的 `feat/lan-workspace-preview` 分支会触发
「多点终端发布」工作流。工作流沿用最新正式版的主版本号和次版本号，递增补丁版本号。
构建阶段不接触私钥。发布阶段使用 `duodian-release` 环境中的
`DUODIAN_UPDATE_SIGNING_KEY`，验证上一版清单，再签名并发布本次提交的两个更新附件。

首次安装使用可信渠道交付的多点终端安装包。此后在「设置 → 更新」点击「立即检查」，下载完成后点「重启并更新」。
安装包携带同版本的公司内部登录扩展和挂载运行时，主机列表、终端布局与 SSH 信任记录保存在工作台配置目录，密码由本机钥匙串管理。
