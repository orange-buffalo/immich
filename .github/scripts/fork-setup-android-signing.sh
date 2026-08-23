#!/usr/bin/env bash
#
# orange-buffalo fork: load the Android signing keystore into GitHub Actions
# secrets, so fork-android.yml can produce a signed APK.
#
# The keystore is NOT in this repository, by design. It lives wherever you
# backed it up. Losing it means no future APK can upgrade an installed one and
# every user must uninstall and reinstall, so keep a durable copy.
#
# Usage:
#   ./fork-setup-android-signing.sh <keystore.jks> <password-file> [--repo owner/name]
#   ./fork-setup-android-signing.sh --generate <output.jks> [--repo owner/name]
#
# Requires: gh (authenticated, admin on the repo), keytool, base64.

set -euo pipefail

REPO="orange-buffalo/immich"
ALIAS_NAME="orange-buffalo"
GENERATE=0
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --generate) GENERATE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

command -v gh >/dev/null || die "gh is not installed"
command -v keytool >/dev/null || die "keytool is not installed (install a JDK)"

if [[ $GENERATE -eq 1 ]]; then
  KEYSTORE="${ARGS[0]:-}"
  [[ -n "$KEYSTORE" ]] || die "usage: $0 --generate <output.jks>"
  [[ ! -e "$KEYSTORE" ]] || die "$KEYSTORE already exists — refusing to overwrite a signing key"

  PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
  PASSWORD_FILE="${KEYSTORE%.jks}.password"
  [[ ! -e "$PASSWORD_FILE" ]] || die "$PASSWORD_FILE already exists"

  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -alias "$ALIAS_NAME" \
    -storepass "$PASSWORD" -keypass "$PASSWORD" \
    -dname "CN=orange-buffalo immich, O=orange-buffalo, C=US"

  printf '%s' "$PASSWORD" > "$PASSWORD_FILE"
  chmod 600 "$KEYSTORE" "$PASSWORD_FILE"
  echo
  echo "Generated $KEYSTORE with password in $PASSWORD_FILE."
  echo "Back both up now — they exist nowhere else."
else
  KEYSTORE="${ARGS[0]:-}"
  PASSWORD_FILE="${ARGS[1]:-}"
  [[ -n "$KEYSTORE" && -n "$PASSWORD_FILE" ]] ||
    die "usage: $0 <keystore.jks> <password-file>"
  [[ -f "$KEYSTORE" ]] || die "no such keystore: $KEYSTORE"
  [[ -f "$PASSWORD_FILE" ]] || die "no such password file: $PASSWORD_FILE"
  PASSWORD="$(cat "$PASSWORD_FILE")"
fi

# Fail before touching secrets if the password does not open the keystore.
keytool -list -keystore "$KEYSTORE" -storepass "$PASSWORD" >/dev/null 2>&1 ||
  die "password does not open $KEYSTORE"

keytool -list -keystore "$KEYSTORE" -storepass "$PASSWORD" -alias "$ALIAS_NAME" >/dev/null 2>&1 ||
  die "keystore has no key with alias '$ALIAS_NAME'"

FINGERPRINT="$(keytool -list -v -keystore "$KEYSTORE" -storepass "$PASSWORD" -alias "$ALIAS_NAME" |
  awk -F': ' '/SHA256:/ { print $2; exit }')"

echo "Repository:  $REPO"
echo "Alias:       $ALIAS_NAME"
echo "SHA-256:     $FINGERPRINT"
echo

base64 -w0 "$KEYSTORE" | gh secret set KEY_JKS               --repo "$REPO"
printf '%s' "$PASSWORD"  | gh secret set ANDROID_STORE_PASSWORD --repo "$REPO"
printf '%s' "$PASSWORD"  | gh secret set ANDROID_KEY_PASSWORD   --repo "$REPO"
printf '%s' "$ALIAS_NAME" | gh secret set ALIAS                 --repo "$REPO"

echo
echo "Secrets set. Verify with: gh secret list --repo $REPO"
echo "fork-android.yml checks that published APKs carry this certificate."
