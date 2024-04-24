#!/usr/bin/env zsh
# zshrc
# ---
# Sheldon cache adapted from:
# https://zenn.dev/fuzmare/articles/zsh-plugin-manager-cache
# https://github.com/fuzmare/dotfiles/blob/c44d32f54944e425399a2fa2f7ef50fe4870f3a6/.config/zsh/.zshrc

function zcompare {
  if [[ -s ${1} && ( ! -s ${1}.zwc || ${1} -nt ${1}.zwc) ]]; then
    echo "\033[1;36mCompiling\033[m ${1}"
    zcompile "${1}"
  fi
}

function source {
  zcompare "$1"
  builtin source "$1"
}

source "$HOME/.config/bash/exports"
zcompare "${ZDOTDIR:-${HOME}}/.zshrc"


# If unset, then ZLE_REMOVE_SUFFIX_CHARS is ' \t\n;&|'; I don't want | included
ZLE_REMOVE_SUFFIX_CHARS=$' \t\n;&'

# Set path to repositories for Znap to manage to the Sheldon plugin path
zstyle ':znap:*' repos-dir "$XDG_DATA_HOME/sheldon/repos/github.com"

sheldon_plugins_toml="${SHELDON_CONFIG_FILE:-${SHELDON_CONFIG_DIR:-${XDG_CONFIG_HOME}/sheldon}/plugins.toml}"
sheldon_source_cache="${XDG_CACHE_HOME}/zsh/sheldon.$(basename "${sheldon_plugins_toml}" .toml).zsh"
if [[ ! -r "$sheldon_source_cache" || "$sheldon_plugins_toml" -nt "$sheldon_source_cache" ]]; then
  echo "\033[1;36mRefreshing Sheldon cache\033[m"
  sheldon source > "$sheldon_source_cache"
fi
source "$sheldon_source_cache"
unset sheldon_source_cache sheldon_plugins_toml

zsh-defer unfunction source

zstyle :omz:plugins:keychain agents gpg
zstyle :omz:plugins:keychain identities id_rsa 273811323AC30470
zstyle :omz:plugins:keychain options --ignore-missing --quiet --attempts 2

source ~/.zshrc.local 2>/dev/null || true
