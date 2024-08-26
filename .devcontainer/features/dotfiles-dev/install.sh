#!/usr/bin/env bash

set -e

USERNAME="${USERNAME:-"automatic"}"

DOTFILES_DEV_PATH="/usr/local/share/dotfiles-dev"

if [ "$(id -u)" -ne 0 ]; then
    echo -e 'Script must be run as root. Use sudo, su, or add "USER root" to your Dockerfile before running this script.'
    exit 1
fi

# Ensure that login shells get the correct path if the user updated the PATH using ENV.
rm -f /etc/profile.d/00-restore-env.sh
echo "export PATH=${PATH//$(sh -lc 'echo $PATH')/\$PATH}" > /etc/profile.d/00-restore-env.sh
chmod +x /etc/profile.d/00-restore-env.sh

# If in automatic mode, determine if a user already exists, if not use vscode
if [ "${USERNAME}" = "auto" ] || [ "${USERNAME}" = "automatic" ]; then
    if [ "${_REMOTE_USER}" != "root" ]; then
        USERNAME="${_REMOTE_USER}"
    else
        USERNAME=""
        POSSIBLE_USERS=("devcontainer" "vscode" "node" "codespace" "$(awk -v val=1000 -F ":" '$3==val{print $1}' /etc/passwd)")
        for CURRENT_USER in "${POSSIBLE_USERS[@]}"; do
            if id -u ${CURRENT_USER} > /dev/null 2>&1; then
                USERNAME=${CURRENT_USER}
                break
            fi
        done
        if [ "${USERNAME}" = "" ]; then
            USERNAME=vscode
        fi
    fi
elif [ "${USERNAME}" = "none" ] || ! id -u ${USERNAME} > /dev/null 2>&1; then
    USERNAME=root
fi

if [ ! -d "${DOTFILES_DEV_PATH}" ]; then
    mkdir -p "${DOTFILES_DEV_PATH}"
fi

# --- Generate a 'post-create.sh' script to be executed by the 'postCreateCommand' lifecycle hook
POST_CREATE_SCRIPT_PATH="${DOTFILES_DEV_PATH}/post-create.sh"

tee "$POST_CREATE_SCRIPT_PATH" > /dev/null \
<< EOF
#!/bin/sh
set -e
EOF

tee -a "$POST_CREATE_SCRIPT_PATH" > /dev/null \
<< 'EOF'

GIT_DIR="${GIT_DIR:-${HOME}/.dotfiles}"
GIT_WORK_TREE="${GIT_WORK_TREE:-${HOME}}"
export GIT_DIR GIT_WORK_TREE

if ! git ls-files -- "$GIT_DIR" >/dev/null 2>&1; then
    echo "Cloning dotfiles into bare repo ‘${GIT_DIR}’..."
    if [ -n "$GH_TOKEN" ] && type gh >/dev/null 2>&1; then
        gh repo clone marcusrbrown/.dotfiles "$GIT_DIR" -- --bare 2>&1
    else
        git clone --bare https://github.com:marcusrbrown/.dotfiles.git "$GIT_DIR" 2>&1
    fi
fi

if git ls-files -- "$GIT_DIR" >/dev/null 2>&1; then
    if [ ! -s "${GIT_DIR}/.gitconfig" ]; then
        echo "Checking out dotfiles bare repo into ‘${GIT_WORK_TREE}’..."
        git checkout --force main
        git config --local include.path .gitconfig
    fi
fi
EOF

chmod 0755 "$POST_CREATE_SCRIPT_PATH"

echo "Done!"