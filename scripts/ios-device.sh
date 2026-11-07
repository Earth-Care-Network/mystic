#!/bin/sh
# Build Mystic for your own iPhone or iPad and install it over USB or Wi-Fi.
#
#   APPLE_DEVELOPMENT_TEAM=ABCDE12345 sh scripts/ios-device.sh
#
# Before the first run (once):
#   1. Xcode → Settings → Accounts → + → sign in with your Apple ID.
#      A free account works (the app then runs for 7 days before you reinstall).
#   2. Your team ID is shown there (Team: … (ABCDE12345)), or on
#      https://developer.apple.com/account under Membership.
#   3. Plug the iPhone in, tap Trust, and turn on Settings → Privacy & Security →
#      Developer Mode (the phone restarts).
#   4. After the first install: Settings → General → VPN & Device Management →
#      trust your developer certificate.
set -eu
[ -n "${APPLE_DEVELOPMENT_TEAM:-}" ] || { echo "Set APPLE_DEVELOPMENT_TEAM to your team ID (see the top of this script)." >&2; exit 1; }
cd "$(dirname "$0")/.."

device=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone|iPad/ && /available|connected/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F-]{25,}$/) {print $i; exit}}')
[ -n "$device" ] || { echo "No iPhone or iPad is connected and trusted. Plug it in and tap Trust." >&2; exit 1; }

bun install --frozen-lockfile
bunx tauri ios build --export-method debugging
ipa=$(ls src-tauri/gen/apple/build/arm64/*.ipa | head -n 1)
echo "Installing $ipa on $device…"
xcrun devicectl device install app --device "$device" "$ipa"
echo "Mystic is on your device. Open it, choose a server, and sign in."
