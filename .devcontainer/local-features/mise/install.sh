#!/usr/bin/env bash

set -e

if [ "$(id -u)" -ne 0 ]; then
    echo -e 'Script must be run as root. Use sudo, su, or add "USER root" to your Dockerfile before running this script.'
    exit 1
fi

MISE_INSTALL_PATH=/usr/local/bin/mise
curl https://mise.run | MISE_INSTALL_PATH="$MISE_INSTALL_PATH" sh

"$MISE_INSTALL_PATH" --version
