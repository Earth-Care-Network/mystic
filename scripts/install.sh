#!/bin/sh
# Install Mystic by Earth Care Network on a Mac.
#
#   curl -fsSL https://earth-care-network.github.io/mystic/install.sh | sh
#
# Downloads the latest release from GitHub, checks it against the release's
# SHA-256 checksums, and copies Mystic.app into /Applications (or ~/Applications
# when /Applications isn't writable). Nothing else on your Mac is changed.
set -eu

REPO="Earth-Care-Network/mystic"
BASE="https://github.com/$REPO/releases/latest/download"
DMG_NAME="Mystic.dmg"

say() { printf '%s\n' "$*"; }
fail() { printf 'Mystic install: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS. Other systems: https://github.com/$REPO/releases/latest"
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 12 ] || fail "Mystic needs macOS 12 or newer."

tmp=$(mktemp -d)
mnt="$tmp/mnt"
cleanup() { hdiutil detach "$mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT INT TERM

say "Downloading Mystic…"
curl -fL --progress-bar -o "$tmp/$DMG_NAME" "$BASE/$DMG_NAME" || fail "couldn't download $BASE/$DMG_NAME"
curl -fsSL -o "$tmp/SHA256SUMS.txt" "$BASE/SHA256SUMS.txt" || fail "couldn't download the checksums"

say "Checking it…"
expected=$(awk -v f="$DMG_NAME" '$2 == f || $2 == "*"f {print $1}' "$tmp/SHA256SUMS.txt")
[ -n "$expected" ] || fail "the checksums don't list $DMG_NAME"
actual=$(shasum -a 256 "$tmp/$DMG_NAME" | awk '{print $1}')
[ "$expected" = "$actual" ] || fail "the download doesn't match its checksum. Nothing was installed."

mkdir -p "$mnt"
hdiutil attach "$tmp/$DMG_NAME" -nobrowse -readonly -quiet -mountpoint "$mnt" || fail "couldn't open the disk image"
[ -d "$mnt/Mystic.app" ] || fail "the disk image has no Mystic.app"

dest="/Applications"
[ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }

if pgrep -xq mystic; then
  say "Mystic is open. Quitting it to update…"
  osascript -e 'quit app "Mystic"' >/dev/null 2>&1 || true
  sleep 2
fi

say "Installing to $dest…"
rm -rf "$dest/Mystic.app"
ditto "$mnt/Mystic.app" "$dest/Mystic.app"
# The app's own signature must be intact, whoever signed it.
codesign --verify --deep --strict "$dest/Mystic.app" 2>/dev/null || { rm -rf "$dest/Mystic.app"; fail "Mystic's signature didn't verify. Nothing was installed."; }
if spctl -a -t exec "$dest/Mystic.app" 2>/dev/null; then
  : # Signed with a Developer ID and notarized by Apple: macOS opens it as is.
else
  # Not notarized yet (ad-hoc signed). You chose to install this verified download, so
  # let macOS open it without the "can't be checked" prompt. Notarized builds skip this.
  say "This build isn't notarized by Apple yet. Opening it anyway, since you installed it from a verified download."
  xattr -dr com.apple.quarantine "$dest/Mystic.app" 2>/dev/null || true
fi

version=$(defaults read "$dest/Mystic.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")
say ""
say "Mystic ${version} is installed in $dest."
say "Open it from Launchpad or Applications, or run:  open -a Mystic"
say "It keeps itself up to date from here."
