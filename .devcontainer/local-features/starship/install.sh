#!/usr/bin/env bash

set -e

if [ "$(id -u)" -ne 0 ]; then
    echo -e 'Script must be run as root. Use sudo, su, or add "USER root" to your Dockerfile before running this script.'
    exit 1
fi

# Install starship
curl -sS https://starship.rs/install.sh | sh -- -s -- --verbose --yes --bin-dir ~/.local/bin
