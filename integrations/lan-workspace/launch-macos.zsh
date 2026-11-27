#!/bin/zsh
set -euo pipefail
umask 077

integration="$(cd -- "$(dirname -- "$0")" && pwd)"
profile="${HERDR_LAN_HOME:?HERDR_LAN_HOME must point at a dedicated Herdr profile}"
installed_app="${HERDR_LAN_APP:-/Applications/Herdr.app}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

node_binary="$(command -v node || true)"
if [[ -z "$node_binary" ]]; then
  print -u2 '启动器需要 Node.js 22 或更新版本。'
  exit 1
fi
if ! [[ -x "$installed_app/Contents/MacOS/Herdr" ]]; then
  print -u2 '找不到 Herdr.app。'
  exit 1
fi
if ! command -v hc >/dev/null; then
  print -u2 '找不到 Herdr 的终端运行时 hc。'
  exit 1
fi
if ! "$node_binary" -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)'; then
  print -u2 '启动器需要 Node.js 22 或更新版本。'
  exit 1
fi
mkdir -p "$profile/mods/lan-workspace" "$profile/core-state" "$profile/core-config" "$integration/.cache"
profile="${profile:A}"
fingerprint="$(printf %s "$profile" | /usr/bin/shasum -a 256 | cut -c1-16)"
core_socket="/private/tmp/herdr-lan-$fingerprint/core.sock"
socket_directory="${core_socket:h}"
mkdir -m 700 "$socket_directory" 2>/dev/null || true
if [[ ! -d "$socket_directory" || -L "$socket_directory" || ! -O "$socket_directory" ]]; then
  print -u2 '无法创建安全的 Herdr 工作台连接目录。'
  exit 1
fi
chmod 700 "$socket_directory"

if ! [[ -f "$integration/node_modules/ssh2/package.json" ]]; then
  npm --prefix "$integration" ci --omit=optional --ignore-scripts --no-audit --no-fund
fi
keychain_binary="$integration/.cache/keychain"
if [[ ! -x "$keychain_binary" || "$integration/keychain.swift" -nt "$keychain_binary" ]]; then
  /usr/bin/swiftc -O "$integration/keychain.swift" -o "$keychain_binary"
fi
runtime="$profile/runtime"
mkdir -p "$runtime"
smb_binary="$("$node_binary" --input-type=module - "$integration" <<'NODE'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const source = pathToFileURL(join(process.argv[2], 'build-smb-server.mjs'))
const { buildSmbServer } = await import(source.href)
console.log(await buildSmbServer())
NODE
)"
# Stage executable content outside macOS's protected Documents folder.
for runtime_file in workspace.mjs ssh.mjs lan-smb-mount.mjs local-preview.mjs shell.mjs build-smb-server.mjs; do
  /usr/bin/install -m 600 "$integration/$runtime_file" "$runtime/$runtime_file"
done
if ! [[ -f "$runtime/node_modules/ssh2/package.json" ]]; then
  /usr/bin/ditto "$integration/node_modules" "$runtime/node_modules"
fi
if ! cmp -s "$keychain_binary" "$runtime/keychain"; then
  /usr/bin/install -m 700 "$keychain_binary" "$runtime/keychain"
fi
if ! cmp -s "$smb_binary" "$runtime/herdr-lan-smb"; then
  /usr/bin/install -m 700 "$smb_binary" "$runtime/herdr-lan-smb"
fi
cp "$integration/mod/"{main.js,mod.json} "$profile/mods/lan-workspace/"
"$node_binary" - "$profile" "$runtime" "$node_binary" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [profile, runtime, node] = process.argv.slice(2)
fs.writeFileSync(path.join(profile, 'mods/lan-workspace/runtime.json'), JSON.stringify({
  node,
  workspace: path.join(runtime, 'workspace.mjs'),
  keychain: path.join(runtime, 'keychain'),
  smbServer: path.join(runtime, 'herdr-lan-smb'),
  stateDir: path.join(profile, 'ssh-hosts'),
}), { mode: 0o600 })
NODE
if [[ "${1:-}" == '--prepare' ]]; then exit 0; fi
application="$profile/Herdr.app"
if ! [[ -x "$application/Contents/MacOS/Herdr" ]]; then
  /usr/bin/ditto "$installed_app" "$application"
fi
if env HERDR_APP_HOME="$profile" "$application/Contents/MacOS/Herdr" status >/dev/null 2>&1; then
  print 'Herdr 局域网工作台已经打开。'
  exit 0
fi
open_flags=(-n)
if [[ "${1:-}" == '--background' ]]; then open_flags+=(-g -j); fi
exec /usr/bin/open "${open_flags[@]}" -a "$application" \
  --env "HERDR_APP_HOME=$profile" \
  --env "HC_SESSION=herdr-lan-$fingerprint" \
  --env "HC_SOCKET=$core_socket" \
  --env "XDG_STATE_HOME=$profile/core-state" \
  --env "XDG_CONFIG_HOME=$profile/core-config" \
  --env "PATH=$PATH" --env "HERDR_TELEMETRY=off" \
  --stdout "$profile/app-stdout.log" --stderr "$profile/app-stderr.log"
