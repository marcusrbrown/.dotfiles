#!/usr/bin/env bash
#
# Based on https://github.com/dhoeric/features/blob/main/src/act/install.sh

set -eo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo -e 'Script must be run as root. Use sudo, su, or add "USER root" to your Dockerfile before running this script.'
    exit 1
fi

# Clean up
clean_up() {
    rm -rf /var/lib/apt/lists/*
}
clean_up

apt_get_update() {
    echo "Running apt-get update..."
    apt-get update -y
}

# Checks if packages are installed and installs them if not
check_packages() {
    if ! dpkg -s "$@" >/dev/null 2>&1; then
        if [ "$(find /var/lib/apt/lists/* | wc -l)" = "0" ]; then
            apt_get_update
        fi
        apt-get -y install --no-install-recommends "$@"
    fi
}

export DEBIAN_FRONTEND=noninteractive

# renovate: datasource=github-releases packageName=danielrobbins/keychain
KEYCHAIN_VERSION=3.0.4

# Install dependencies
check_packages curl python3

# Use a temporary location for the keychain zipapp
export TMP_DIR="/tmp/tmp-keychain"
mkdir -p "${TMP_DIR}"
chmod 700 "${TMP_DIR}"

# Install keychain from the published, checksum-verified zipapp release
echo "(*) Installing keychain ${KEYCHAIN_VERSION}..."
KEYCHAIN_ARCHIVE="keychain-${KEYCHAIN_VERSION}.pyz"
KEYCHAIN_BASE_URL="https://github.com/danielrobbins/keychain/releases/download/${KEYCHAIN_VERSION}"
curl -fsSL -o "${TMP_DIR}/${KEYCHAIN_ARCHIVE}" "${KEYCHAIN_BASE_URL}/${KEYCHAIN_ARCHIVE}"
curl -fsSL -o "${TMP_DIR}/SHA256SUMS" "${KEYCHAIN_BASE_URL}/SHA256SUMS"

(cd "${TMP_DIR}" && sha256sum --ignore-missing -c SHA256SUMS)

mv "${TMP_DIR}/${KEYCHAIN_ARCHIVE}" /usr/local/bin/keychain
chmod 0755 /usr/local/bin/keychain
rm -rf "${TMP_DIR}"

keychain --version

clean_up

echo "Done!"
