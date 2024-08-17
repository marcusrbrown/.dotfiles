#!/bin/bash

set -Eeuo pipefail

env | sort

if [[ "${CODESPACES}" == true ]]; then
  echo "Fixing permissions of /tmp for GitHub Codespaces..." >&2
  sudo chmod 1777 /tmp
fi

[ -z "${GIT_DIR}" ] && GIT_DIR="${HOME}"/.dotfiles
[ -z "${GIT_WORK_TREE}" ] && GIT_WORK_TREE="${HOME}"
export GIT_DIR GIT_WORK_TREE

git clone --bare git@github.com:marcusrbrown/.dotfiles.git "$GIT_DIR"
git checkout --force origin/main main
