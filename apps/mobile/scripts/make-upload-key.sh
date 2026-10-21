#!/usr/bin/env bash
# Creates the FORM Play Store UPLOAD key, once. Run it in Git Bash (it only needs openssl, which comes
# with Git for Windows; no Java needed):
#
#   bash apps/mobile/scripts/make-upload-key.sh            # writes to ~/form-keys/
#   bash apps/mobile/scripts/make-upload-key.sh /d/keys    # or to a folder you choose
#
# It writes, outside the repository:
#   upload-key.p12            the keystore (PKCS12, alias "upload"). SECRET. Back it up.
#   upload-key.p12.base64.txt the same keystore as one line of text, for the GitHub secret. SECRET.
#   upload-certificate.pem    the public certificate (safe to share; Google asks for it on a key reset)
# Nothing secret is printed to the screen.

set -euo pipefail

# Git Bash rewrites an argument that starts with "/" (like the "/CN=..." below) into a Windows path, so
# that one command runs with MSYS_NO_PATHCONV=1 and gets Windows-style file paths (wp) instead.
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf "%s" "$1"; fi; }

ALIAS="upload"
KEY_BITS=4096
VALID_DAYS=10958 # 30 years (Google requires the certificate to be valid beyond 2033)

command -v openssl >/dev/null 2>&1 || { echo "openssl was not found. Run this in Git Bash (Git for Windows includes it)."; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd -P)

OUT_DIR_ARG="${1:-$HOME/form-keys}"
mkdir -p "$OUT_DIR_ARG"
OUT_DIR=$(cd "$OUT_DIR_ARG" && pwd -P)

# Refuse to write inside the repository (or any git working copy): a key there could be committed.
case "$OUT_DIR/" in
  "$REPO_ROOT"/*) echo "Refusing to write inside the repository ($REPO_ROOT). Choose a folder outside it."; rmdir "$OUT_DIR" 2>/dev/null; exit 1 ;;
esac
d="$OUT_DIR"
while [ "$d" != "/" ] && [ -n "$d" ]; do
  if [ -e "$d/.git" ]; then echo "Refusing to write inside a git working copy ($d). Choose another folder."; exit 1; fi
  d=$(dirname "$d")
done

P12="$OUT_DIR/upload-key.p12"
B64="$OUT_DIR/upload-key.p12.base64.txt"
CERT="$OUT_DIR/upload-certificate.pem"
if [ -e "$P12" ] || [ -e "$B64" ] || [ -e "$CERT" ]; then
  echo "A key already exists in $OUT_DIR. I will not overwrite it (losing the old key would lock you out of updates)."
  echo "Move it away deliberately if you really want a new one."
  exit 1
fi

read -r -p "Your name or organisation (shown in the certificate): " ORG
ORG=$(printf '%s' "$ORG" | tr -d '/\\,=+"<>;#')
[ -n "$ORG" ] || { echo "An organisation name is needed."; exit 1; }

read -r -s -p "Choose a keystore password (at least 8 characters): " PW; echo
read -r -s -p "Type it again: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "The passwords do not match."; exit 1; }
[ "${#PW}" -ge 8 ] || { echo "Use at least 8 characters."; exit 1; }
unset PW2
export FORM_KEY_PW="$PW"
unset PW

umask 077
WORK=$(mktemp -d "$OUT_DIR/.work.XXXXXX")
cleanup() { rm -rf "$WORK"; unset FORM_KEY_PW; }
trap cleanup EXIT

echo "Creating a $KEY_BITS-bit RSA key (this takes a few seconds)..."
openssl genrsa -out "$WORK/key.pem" "$KEY_BITS" 2>/dev/null
MSYS_NO_PATHCONV=1 openssl req -new -x509 -sha256 -key "$(wp "$WORK/key.pem")" -days "$VALID_DAYS" \
  -subj "/CN=FORM Upload/O=$ORG" -out "$(wp "$CERT")"
openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$CERT" -name "$ALIAS" \
  -passout env:FORM_KEY_PW -out "$P12"

# Check the keystore opens with the password before anything is relied on.
openssl pkcs12 -in "$P12" -noout -passin env:FORM_KEY_PW >/dev/null 2>&1 \
  || { echo "The keystore could not be read back. Nothing was kept."; rm -f "$P12" "$CERT"; exit 1; }

openssl base64 -A -in "$P12" > "$B64"
chmod 600 "$P12" "$B64" 2>/dev/null || true

FINGERPRINT=$(openssl x509 -in "$CERT" -noout -fingerprint -sha256 | sed 's/^.*=//')

cat <<EOF

Done. Files in $OUT_DIR:
  upload-key.p12             the keystore. SECRET.
  upload-key.p12.base64.txt  the keystore as text, for GitHub. SECRET.
  upload-certificate.pem     public certificate.

Upload certificate SHA-256 fingerprint (public; Play Console shows the same value):
  $FINGERPRINT

STEP 1 - add four secrets in GitHub
  Open the repository on github.com -> Settings -> Secrets and variables -> Actions -> New repository secret.
  Create these four (names exactly as written):

    ANDROID_UPLOAD_KEYSTORE_BASE64   the single line inside upload-key.p12.base64.txt
                                     (in Git Bash:  clip < "$B64"   then paste into the secret box)
    ANDROID_KEYSTORE_PASSWORD        the password you just typed
    ANDROID_KEY_PASSWORD             the same password again (a PKCS12 key uses the keystore password)
    ANDROID_KEY_ALIAS                $ALIAS

  After pasting, clear the clipboard (copy any other text) and do not paste the secrets anywhere else.

STEP 2 - back the key up NOW, before anything else
  Copy upload-key.p12 and the password to at least TWO separate safe places, for example a password
  manager (attach the file) and an encrypted USB stick or encrypted cloud vault. The password must be
  stored with, but not in the same file as, the keystore.
  If you lose the key you cannot update the app without asking Google to reset the upload key
  (possible only with Play App Signing, takes days, and needs upload-certificate.pem). Never put the
  .p12 or the .base64.txt in the repository, in email, or in chat.

STEP 3 - when everything is set up, delete the plain-text base64 copy:
  rm "$B64"
  (the .p12 is enough to recreate it.)

Then build: GitHub -> Actions -> "Android release" -> Run workflow (see docs/RELEASE.md, "Play Store release").
EOF
