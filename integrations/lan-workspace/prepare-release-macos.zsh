#!/bin/zsh
# Build the application and stage its company-login runtime without signing credentials.
set -euo pipefail
umask 077

version="${1:?usage: prepare-release-macos.zsh version output-directory}"
out="${2:?missing output directory}"
[[ "$(uname -sm)" == 'Darwin arm64' ]]
[[ "$version" =~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' ]]
integration="${0:A:h}"
repo="${integration:h:h}"
mkdir -p "$out"
out="${out:A}"
cd "$repo"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/target}"
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:A}"
DUODIAN_APP_VERSION="$version" cargo build --release --locked
[[ "$("$CARGO_TARGET_DIR/release/herdr-app" --version)" == "herdr-app $version" ]]
HERDR_LAN_HOME="$out/preparation" "$integration/launch-macos.zsh" --prepare
/usr/bin/install -m 755 "$CARGO_TARGET_DIR/release/herdr-app" "$out/herdr-app"
mv -- "$out/preparation/runtime" "$out/runtime"
print -r -- "$version" > "$out/version"
