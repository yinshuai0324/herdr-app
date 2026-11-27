#!/bin/zsh
# Stage the release's LAN mod before the desktop opens. The profile owns user data.
set -euo pipefail
umask 077

resources="${0:A:h}"
profile="$1"
socket_dir="$2"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node_binary="$(command -v node)"
version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$resources/../Info.plist")"
[[ "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]
mkdir -p "$profile/mods/lan-workspace" "$profile/core-state" "$profile/core-config" "$profile/runtime"
mkdir -m 700 "$socket_dir" 2>/dev/null || true
[[ -d "$socket_dir" && ! -L "$socket_dir" && -O "$socket_dir" ]]
chmod 700 "$socket_dir"

runtime="$profile/runtime/release-$version"
if [[ ! -d "$runtime" ]]; then
  pending="$(mktemp -d "$profile/runtime/.release-XXXXXXXX")"
  trap 'rm -rf -- "$pending"' EXIT
  /usr/bin/ditto "$resources/lan-runtime" "$pending"
  mv -- "$pending" "$runtime"
fi
# Keep the installed binary for unchanged source, even when CI uses another Swift compiler.
# Releases through 0.1.22 used this source without writing the stamp.
legacy_keychain_source=ae44add140784a67e9d227bcabc4f7a82bd660a50ba6cbac3ee5c26e901a81de
keychain_source="$(cat "$runtime/keychain-source.sha256")"
installed_source="$(cat "$profile/runtime/keychain-source.sha256" 2>/dev/null || print -r -- "$legacy_keychain_source")"
if [[ ! -x "$profile/runtime/keychain" || "$keychain_source" != "$installed_source" ]]; then
  /usr/bin/install -m 700 "$runtime/keychain" "$profile/runtime/keychain.new"
  mv -f -- "$profile/runtime/keychain.new" "$profile/runtime/keychain"
fi
print -r -- "$keychain_source" > "$profile/runtime/keychain-source.sha256"
mod_dir="$profile/mods/lan-workspace"
for name in main.js mod.json; do
  if ! cmp -s "$resources/lan-mod/$name" "$mod_dir/$name"; then
    /usr/bin/install -m 600 "$resources/lan-mod/$name" "$mod_dir/$name.new"
    mv -f -- "$mod_dir/$name.new" "$mod_dir/$name"
  fi
done
"$node_binary" - "$profile" "$runtime" "$node_binary" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [profile, runtime, node] = process.argv.slice(2)
const config = path.join(profile, 'mods/lan-workspace/runtime.json')
fs.writeFileSync(config + '.new', JSON.stringify({
  node,
  workspace: path.join(runtime, 'workspace.mjs'),
  keychain: path.join(profile, 'runtime/keychain'),
  smbServer: path.join(runtime, 'herdr-lan-smb'),
  stateDir: path.join(profile, 'ssh-hosts'),
}), { mode: 0o600 })
fs.renameSync(config + '.new', config)
NODE
