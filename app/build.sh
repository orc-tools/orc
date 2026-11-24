#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO/app"
BUILD_DIR="$APP_DIR/build"
APP_BUNDLE="$BUILD_DIR/Orc.app"
# ORC_APP_DEST exists for install.sh and bin/test, which build into a temporary
# destination and never launch the result. Agents never start a build made
# here beside the installed app; see skills/_shared/run-contract.md, Build proof.
APP_DEST="${ORC_APP_DEST:-$HOME/Applications/Orc.app}"
CONTENTS="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"

# macOS keys the microphone grant to the designated requirement. An ad-hoc
# requirement is the build's cdhash, which every rebuild changes; a certificate
# that outlives builds keeps the grant across app updates.
SIGNING_DIR="${ORC_HOME:-$HOME/.orc}/signing"
SIGNING_NAME="Orc Local Signing"
SIGNING_KEYCHAIN=""
SIGNING_PASSWORD_FILE=""
SIGNING_ON_SEARCH_LIST=false
OTHER_KEYCHAINS=()

read_other_keychains() {
    local listing entry
    listing="$(security list-keychains -d user | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//')" || return 1
    OTHER_KEYCHAINS=()
    while IFS= read -r entry; do
        [[ -n "$entry" && "$entry" != "$SIGNING_KEYCHAIN" ]] || continue
        OTHER_KEYCHAINS+=("$entry")
    done <<<"$listing"
}

# Filters the live list rather than restoring a snapshot, so a change another
# process made to the search list while we signed survives.
drop_signing_keychain_from_search_list() {
    [[ "$SIGNING_ON_SEARCH_LIST" == true ]] || return 0
    SIGNING_ON_SEARCH_LIST=false
    read_other_keychains || return 0
    security list-keychains -d user -s ${OTHER_KEYCHAINS[@]+"${OTHER_KEYCHAINS[@]}"} || true
}

create_signing_identity() {
    local password tmp="$WORKDIR/signing"
    rm -f "$SIGNING_KEYCHAIN" "$SIGNING_PASSWORD_FILE"
    mkdir -p "$tmp" || return 1
    # /usr/bin/openssl is LibreSSL, whose PKCS#12 files `security import`
    # accepts; Homebrew OpenSSL 3+ writes ones it rejects with "MAC verification failed".
    password="$(/usr/bin/openssl rand -hex 32)" || return 1
    (umask 077 && printf '%s\n' "$password" >"$SIGNING_PASSWORD_FILE") || return 1
    cat >"$tmp/req.cnf" <<EOF || return 1
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $SIGNING_NAME
[codesign]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
    /usr/bin/openssl req -x509 -new -newkey rsa:2048 -nodes -sha256 -days 3650 \
        -config "$tmp/req.cnf" -extensions codesign \
        -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null || return 1
    /usr/bin/openssl pkcs12 -export -name "$SIGNING_NAME" \
        -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -out "$tmp/identity.p12" \
        -passout "file:$SIGNING_PASSWORD_FILE" || return 1
    # create-keychain also puts the new keychain on the search list.
    SIGNING_ON_SEARCH_LIST=true
    security create-keychain -p "$password" "$SIGNING_KEYCHAIN" || return 1
    # No -t: a timed auto-lock would make a later build prompt for the password.
    security set-keychain-settings "$SIGNING_KEYCHAIN" || return 1
    security unlock-keychain -p "$password" "$SIGNING_KEYCHAIN" || return 1
    security import "$tmp/identity.p12" -k "$SIGNING_KEYCHAIN" -P "$password" \
        -T /usr/bin/codesign >/dev/null || return 1
    # Without the partition list, codesign's first use of the key raises a GUI
    # access prompt even though -T already allows codesign.
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
        -k "$password" "$SIGNING_KEYCHAIN" >/dev/null || return 1
    rm -rf "$tmp"
}

sign_with_local_identity() {
    local password identity
    command -v security >/dev/null 2>&1 && [[ -x /usr/bin/openssl ]] || return 1
    mkdir -p "$SIGNING_DIR" && chmod 700 "$SIGNING_DIR" || return 1
    # Physical path, because the search list reports keychains by resolved path
    # and the cleanup filter compares against it.
    SIGNING_KEYCHAIN="$(cd "$SIGNING_DIR" && pwd -P)/orc-signing.keychain-db" || return 1
    SIGNING_PASSWORD_FILE="${SIGNING_KEYCHAIN%/*}/orc-signing.password"
    if [[ ! -f "$SIGNING_KEYCHAIN" || ! -f "$SIGNING_PASSWORD_FILE" ]]; then
        if ! create_signing_identity; then
            rm -f "$SIGNING_KEYCHAIN" "$SIGNING_PASSWORD_FILE"
            return 1
        fi
    fi
    password="$(<"$SIGNING_PASSWORD_FILE")" || return 1
    security unlock-keychain -p "$password" "$SIGNING_KEYCHAIN" || return 1
    # codesign --keychain finds no identity in a keychain that is off the
    # search list.
    read_other_keychains || return 1
    SIGNING_ON_SEARCH_LIST=true
    security list-keychains -d user -s "$SIGNING_KEYCHAIN" \
        ${OTHER_KEYCHAINS[@]+"${OTHER_KEYCHAINS[@]}"} || return 1
    # No -v: it hides a self-signed identity as CSSMERR_TP_NOT_TRUSTED.
    identity="$(security find-identity -p codesigning "$SIGNING_KEYCHAIN" |
        awk -v name="\"$SIGNING_NAME\"" 'index($0, name) { print $2; exit }')" || return 1
    [[ -n "$identity" ]] || return 1
    codesign --force --keychain "$SIGNING_KEYCHAIN" --sign "$identity" "$APP_BUNDLE"
}

echo "==> Scaffolding $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$APP_DIR/Info.plist" "$CONTENTS/Info.plist"

echo "==> Generating icon"
WORKDIR="$(mktemp -d)"
trap 'drop_signing_keychain_from_search_list; rm -rf "$WORKDIR"' EXIT

ICON_PNG="$WORKDIR/orc-1024.png"
DESKTOP_SOURCE="$REPO/assets/orc-desktop-icon-1024.png"

if [[ -f "$DESKTOP_SOURCE" ]]; then
    cp "$DESKTOP_SOURCE" "$ICON_PNG"
fi

if [[ -f "$ICON_PNG" ]]; then
    ICONSET="$WORKDIR/orc.iconset"
    mkdir -p "$ICONSET"
    sips -z 16 16     "$ICON_PNG" --out "$ICONSET/icon_16x16.png"      >/dev/null
    sips -z 32 32     "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null
    sips -z 32 32     "$ICON_PNG" --out "$ICONSET/icon_32x32.png"      >/dev/null
    sips -z 64 64     "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null
    sips -z 128 128   "$ICON_PNG" --out "$ICONSET/icon_128x128.png"    >/dev/null
    sips -z 256 256   "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
    sips -z 256 256   "$ICON_PNG" --out "$ICONSET/icon_256x256.png"    >/dev/null
    sips -z 512 512   "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
    sips -z 512 512   "$ICON_PNG" --out "$ICONSET/icon_512x512.png"    >/dev/null
    sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
    iconutil -c icns "$ICONSET" -o "$RESOURCES_DIR/orc.icns"
else
    echo "NOTE: icon not generated, app will use default icon"
fi

echo "==> Compiling Swift sources"
swiftc -O "$APP_DIR/main.swift" -o "$MACOS_DIR/Orc"

echo "==> Code signing"
if ! sign_with_local_identity; then
    echo "NOTE: no local signing identity, signed ad hoc; macOS will ask for the microphone again after each app update"
    codesign --force --sign - "$APP_BUNDLE"
fi
drop_signing_keychain_from_search_list

echo "==> Installing to $APP_DEST"
rm -rf "$APP_DEST"
mkdir -p "$(dirname "$APP_DEST")"
ditto "$BUILD_DIR/Orc.app" "$APP_DEST"

echo "==> Installed: $APP_DEST"
