#!/usr/bin/env bash

set -e

if [ "$(id -u)" -ne 0 ]; then
    echo -e 'Script must be run as root. Use sudo, su, or add "USER root" to your Dockerfile before running this script.'
    exit 1
fi

echo "(*) Installing mise-en-place..."

MISE_INSTALL_PATH=/usr/local/bin/mise
curl https://mise.run | MISE_INSTALL_PATH="$MISE_INSTALL_PATH" sh

# Validation and activation of mise taken from:
# https://github.com/RouL/devcontainer-features/blob/2ba3812809d9c933cf459f1413e67f63a9a894e3/src/mise/install.sh
eval "$(mise activate bash)"
mise doctor

# Add mise activation to profile
# TODO: Support other base OSes
_mise_profile_path=/etc/profile.d/mise.sh
tee "$_mise_profile_path" > /dev/null << 'EOF'
if [ -n "$ZSH_VERSION" ]; then
   eval "$(mise activate zsh)"
elif [ -n "$BASH_VERSION" ]; then
   eval "$(mise activate bash)"
fi
EOF

chmod 0755 "$_mise_profile_path"

echo "Done!"
