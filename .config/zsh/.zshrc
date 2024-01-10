#!/usr/bin/env zsh
# zshrc
# ---

zcompare() {
  if [[ -s ${1} && ( ! -s ${1}.zwc || ${1} -nt ${1}.zwc) ]]; then
    zcompile "${1}"
  fi
}

source "$HOME/.config/bash/exports"
zcompare "${ZDOTDIR:-${HOME}}/.zshrc"

eval "$(sheldon source)"

# Uncomment to enable debug logging
#export DEBUG=zpm

local cache_dir="${XDG_CACHE_HOME:-${HOME}/.cache}"
local config_dir="${XDG_CONFIG_HOME:-${HOME}/.config}"
local zpm_dir="${cache_dir}/zpm"
: ${_ZPM_CACHE_DIR:="${TMPDIR:-/tmp}/zsh-${UID:-user}"}

# Oh My Zsh
ZSH_CUSTOM="${config_dir}/zsh"
[[ ! -d "${ZSH_CUSTOM}" ]] && mkdir -p "${ZSH_CUSTOM}"
ZSH_COMPDUMP="${_ZPM_CACHE_DIR}/zcompdump"

zstyle :omz:plugins:keychain agents gpg
zstyle :omz:plugins:keychain identities id_rsa 273811323AC30470
zstyle :omz:plugins:keychain options --ignore-missing --quiet --attempts 2

# History


# If unset, then ZLE_REMOVE_SUFFIX_CHARS is ' \t\n;&|'; I don't want | included
ZLE_REMOVE_SUFFIX_CHARS=$' \t\n;&'

# source "${zpm_dir}/zpm.zsh" 2>/dev/null || {
#   local zpm_git_url="https://github.com/marcusrbrown/zpm-zsh_zpm"
#   git clone --depth 1 "$zpm_git_url" "$zpm_dir"
#   source "${zpm_dir}/zpm.zsh"
# }

# # Load plugins that are used by everything else
# zpm load \
#   marcusrbrown/zlugger \
#   @omz

# zpm load \
#   @omz/lib/clipboard \
#   @omz/lib/compfix \
#   @omz/lib/completion \
#   @omz/lib/correction \
#   @omz/lib/directories \
#   @omz/lib/functions \
#   @omz/lib/git \
#   @omz/lib/grep \
#   @omz/lib/history \
#   @omz/lib/key-bindings \
#   @omz/lib/misc \
#   @omz/lib/termsupport \
#   @omz/lib/theme-and-appearance

# zpm if macos load \
#   @omz/macos

# zpm load \
#   @omz/brew \
#   @omz/git

# zpm if vscode load zpm-zsh/vscode

source ~/.zshrc.local 2>/dev/null || true
