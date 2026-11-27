#!/bin/zsh
# Build, sign and publish a 多点终端 release to a local or statically hosted feed.
set -euo pipefail
umask 077

version="${1:?usage: publish-macos.zsh version feed-directory private-key [https-feed]}"
feed_dir="${2:?missing feed directory}"
private_key="${3:?missing signing key}"
[[ "$version" =~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' ]] || { print -u2 '请使用三段数字版本号，例如 0.1.19。'; exit 1; }
[[ "$(uname -sm)" == 'Darwin arm64' && -f "$private_key" ]]
integration="${0:A:h}"
repo="${integration:h:h}"
private_key="${private_key:A}"
mkdir -p "$feed_dir/app"
feed_dir="${feed_dir:A}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node_binary="$(command -v node)"
feed_url="${4:-$("$node_binary" -e 'process.stdout.write(require("node:url").pathToFileURL(process.argv[1]).href)' "$feed_dir")}"
[[ "$feed_url" != *'?'* && "$feed_url" != *'#'* ]]
[[ "$feed_url" == https://* || "$feed_url" == file:///* ]]
archive_name=duodian-macos-aarch64.tar.gz
release_dir="$feed_dir/app/$version"
[[ ! -e "$release_dir" ]] || { print -u2 "版本 $version 已发布。请使用更高的版本号。"; exit 1; }

lock="$feed_dir/.publish-lock"
mkdir -- "$lock" 2>/dev/null || { print -u2 '此更新源已有发布任务。'; exit 1; }
work=
pending=
cleanup() {
  if [[ -n "$work" ]]; then rm -rf -- "$work"; fi
  if [[ -n "$pending" ]]; then rm -rf -- "$pending"; fi
  rmdir -- "$lock"
}
trap cleanup EXIT
work="$(mktemp -d /private/tmp/duodian-package.XXXXXXXX)"
pending="$(mktemp -d "$feed_dir/.publishing.XXXXXXXX")"
cd "$repo"
/usr/bin/openssl pkey -in "$private_key" -pubout -out "$work/public.pem"
if [[ -f "$feed_dir/app/latest.json" ]]; then
  "$node_binary" - "$feed_dir/app/latest.json" "$work" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [, , file, work] = process.argv
const { payload, signature } = JSON.parse(fs.readFileSync(file))
fs.writeFileSync(path.join(work, 'previous.json'), Buffer.from(payload, 'base64'))
fs.writeFileSync(path.join(work, 'previous.sig'), Buffer.from(signature, 'base64'))
NODE
  /usr/bin/openssl dgst -sha256 -verify "$work/public.pem" -signature "$work/previous.sig" "$work/previous.json" >/dev/null
  "$node_binary" - "$work/previous.json" "$version" <<'NODE'
const last = JSON.parse(require('node:fs').readFileSync(process.argv[2]))
const before = last.version.split('.').map(BigInt)
const after = process.argv[3].split('.').map(BigInt)
const first = after.findIndex((part, i) => part !== before[i])
if (last.product !== 'duodian-terminal' || first === -1 || after[first] <= before[first]) {
  throw new Error('版本号必须高于当前已发布版本。')
}
NODE
fi
inputs="${DUODIAN_RELEASE_INPUTS:-}"
if [[ -z "$inputs" ]]; then
  inputs="$work/inputs"
  "$integration/prepare-release-macos.zsh" "$version" "$inputs"
fi
[[ "$(cat "$inputs/version")" == "$version" && -x "$inputs/herdr-app" ]]
[[ -f "$inputs/runtime/node_modules/ssh2/package.json" && -x "$inputs/runtime/keychain" && -x "$inputs/runtime/herdr-lan-smb" ]]

app="$work/多点终端.app"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources" "$pending/version"
/usr/bin/install -m 755 "$inputs/herdr-app" "$app/Contents/MacOS/Herdr"
/usr/bin/install -m 700 "$integration/duodian-launch.zsh" "$resources/duodian-launch.zsh"
cp -- "$work/public.pem" "$resources/duodian-update.pem"
cp -- LICENSE THIRD-PARTY-NOTICES assets/icons/Herdr.icns "$resources/"
/usr/bin/ditto "$inputs/runtime" "$resources/lan-runtime"
/usr/bin/ditto "$integration/mod" "$resources/lan-mod"
"$node_binary" -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({feed:process.argv[2]}))' "$resources/duodian-update.json" "$feed_url"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>Herdr</string>
  <key>CFBundleIdentifier</key><string>dev.herdr.lan.zh</string>
  <key>CFBundleName</key><string>多点终端</string>
  <key>CFBundleDisplayName</key><string>多点终端</string>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>Herdr</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSMicrophoneUsageDescription</key><string>多点终端的终端程序可使用麦克风进行语音输入。</string>
  <key>NSCameraUsageDescription</key><string>多点终端的终端程序可使用摄像头。</string>
  <key>NSAppleEventsUsageDescription</key><string>多点终端的终端程序可通过 AppleScript 控制其他应用。</string>
</dict></plist>
PLIST
scripts/mac-sign "$app"
/usr/bin/codesign --verify --deep --strict "$app"
COPYFILE_DISABLE=1 /usr/bin/tar -czf "$pending/version/$archive_name" -C "$work" '多点终端.app'
sha="$(/usr/bin/shasum -a 256 "$pending/version/$archive_name" | cut -d' ' -f1)"
"$node_binary" -e 'process.stdout.write(JSON.stringify({product:"duodian-terminal",version:process.argv[1],target:"macos-aarch64",sha256:process.argv[2]}))' "$version" "$sha" > "$work/release.json"
/usr/bin/openssl dgst -sha256 -sign "$private_key" -out "$work/release.sig" "$work/release.json"
"$node_binary" - "$work/release.json" "$work/release.sig" <<'NODE' > "$pending/latest.json"
const fs = require('node:fs')
const [payload, signature] = process.argv.slice(2).map(file => fs.readFileSync(file).toString('base64'))
process.stdout.write(JSON.stringify({ payload, signature }) + '\n')
NODE
cp -- "$pending/latest.json" "$pending/version/duodian-latest.json"
chmod 644 "$pending/latest.json" "$pending/version/duodian-latest.json" "$pending/version/$archive_name"
chmod 755 "$pending/version"
mv -- "$pending/version" "$release_dir"
mv -f -- "$pending/latest.json" "$feed_dir/app/latest.json"
print -- "$release_dir/$archive_name"
