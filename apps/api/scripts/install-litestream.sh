#!/bin/sh
# Installs a pinned Litestream (continuous SQLite backup to Cloudflare R2) into apps/api/bin/.
# Run by Render's build step (Linux x86_64). The download is checked against a SHA-256 taken from the
# release's own checksums.txt before anything is extracted; a mismatch fails the build.
#
# To upgrade: change VERSION, then SHA256 from
#   https://github.com/benbjohnson/litestream/releases/download/v<VERSION>/checksums.txt
# (the litestream-<VERSION>-linux-x86_64.tar.gz line), and re-check litestream.yml against that
# version's docs (https://litestream.io/reference/config/).
set -eu

VERSION="0.5.17"
SHA256="cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d"
ARCHIVE="litestream-${VERSION}-linux-x86_64.tar.gz"
URL="https://github.com/benbjohnson/litestream/releases/download/v${VERSION}/${ARCHIVE}"

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "install-litestream: this installer is for Linux x86_64 only (found $(uname -s) $(uname -m))" >&2
  exit 1
fi

BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "install-litestream: downloading Litestream v${VERSION}"
curl -fsSL --retry 3 --retry-delay 2 --max-time 120 "$URL" -o "$TMP/$ARCHIVE"

echo "${SHA256}  ${ARCHIVE}" > "$TMP/archive.sha256"
(cd "$TMP" && sha256sum -c archive.sha256 >/dev/null) || {
  echo "install-litestream: SHA-256 mismatch for ${ARCHIVE}; refusing to install" >&2
  exit 1
}

mkdir -p "$BIN_DIR"
tar -xzf "$TMP/$ARCHIVE" -C "$TMP" litestream
mv "$TMP/litestream" "$BIN_DIR/litestream"
chmod 755 "$BIN_DIR/litestream"
echo "install-litestream: installed v${VERSION} to apps/api/bin/litestream"
