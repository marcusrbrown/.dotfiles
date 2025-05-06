#!/usr/bin/env bash
#
# Based on https://github.com/dhoeric/features/blob/main/src/act/install.sh

KEYCHAIN_VERSION=${VERSION:-"latest"}

set -e

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

find_version_from_git_tags() {
    local variable_name=$1
    local requested_version=${!variable_name}
    if [ "${requested_version}" = "none" ]; then return; fi
    local repository=$2
    local prefix=${3:-"tags/v"}
    local separator=${4:-"."}
    local last_part_optional=${5:-"false"}
    if [ "$(echo "${requested_version}" | grep -o "." | wc -l)" != "2" ]; then
        local escaped_separator=${separator//./\\.}
        local last_part
        if [ "${last_part_optional}" = "true" ]; then
            last_part="(${escaped_separator}[0-9]+)?"
        else
            last_part="${escaped_separator}[0-9]+"
        fi
        local regex="${prefix}\\K[0-9]+${escaped_separator}[0-9]+${last_part}$"
        local version_list="$(git ls-remote --tags ${repository} | grep -oP "${regex}" | tr -d ' ' | tr "${separator}" "." | sort -rV)"
        if [ "${requested_version}" = "latest" ] || [ "${requested_version}" = "current" ] || [ "${requested_version}" = "lts" ]; then
            declare -g ${variable_name}="$(echo "${version_list}" | head -n 1)"
        else
            set +e
            declare -g ${variable_name}="$(echo "${version_list}" | grep -E -m 1 "^${requested_version//./\\.}([\\.\\s]|$)")"
            set -e
        fi
    fi
    if [ -z "${!variable_name}" ] || ! echo "${version_list}" | grep "^${!variable_name//./\\.}$" >/dev/null 2>&1; then
        echo -e "Invalid ${variable_name} value: ${requested_version}\nValid values:\n${version_list}" >&2
        exit 1
    fi
    echo "${variable_name}=${!variable_name}"
}

# Install dependencies
check_packages curl git tar

# Use a temporary locaiton for keychain archive
export TMP_DIR="/tmp/tmp-keychain"
mkdir -p ${TMP_DIR}
chmod 700 ${TMP_DIR}

# Install keychain
echo "(*) Installing keychain ${KEYCHAIN_VERSION}..."
find_version_from_git_tags KEYCHAIN_VERSION "https://github.com/funtoo/keychain" "tags/"

KEYCHAIN_VERSION="${KEYCHAIN_VERSION#v}"
KEYCHAIN_ARCHIVE="keychain-${KEYCHAIN_VERSION}.tar.gz"
KEYCHAIN_URL="https://github.com/funtoo/keychain/archive/refs/tags/${KEYCHAIN_VERSION}.tar.gz"
curl -sSL -o ${TMP_DIR}/"${KEYCHAIN_ARCHIVE}" "${KEYCHAIN_URL}"
tar -xzf ${TMP_DIR}/"${KEYCHAIN_ARCHIVE}" -C ${TMP_DIR} --strip-components=1
make -C ${TMP_DIR} keychain
ls -la ${TMP_DIR}
mv ${TMP_DIR}/keychain /usr/local/bin/keychain
chmod 0755 /usr/local/bin/keychain
rm -rf ${TMP_DIR}

keychain --version

clean_up

echo "Done!"
