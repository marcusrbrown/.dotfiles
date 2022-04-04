#!/usr/bin/env zsh

# Uncomment to enable debug logging
#export DEBUG=zpm

local cache_dir="${XDG_CACHE_HOME:-${HOME}/.cache}"
local config_dir="${XDG_CONFIG_HOME:-${HOME}/.config}"
local zpm_dir="${cache_dir}/zpm"
: ${_ZPM_CACHE_DIR:="${TMPDIR:-/tmp}/zsh-${UID:-user}"}

# The name of generated plugin scripts
local generated="zpm-generated.zsh"

# Oh My Zsh
ZSH_CUSTOM="${config_dir}/zsh"
[[ ! -d "${ZSH_CUSTOM}" ]] && mkdir -p "${ZSH_CUSTOM}"
ZSH_COMPDUMP="${_ZPM_CACHE_DIR}/zcompdump"

# Fast Syntax Highlighting
FAST_WORK_DIR="${config_dir}/fsh"
[[ ! -w "${FAST_WORK_DIR}" ]] && command mkdir -p "${FAST_WORK_DIR}"

# zsh-autosuggestions
ZSH_AUTOSUGGEST_MANUAL_REBIND=true
typeset -ga ZSH_AUTOSUGGEST_STRATEGY
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
ZSH_AUTOSUGGEST_USE_ASYNC=true

# zsh-nvm
NVM_COMPLETION=true
NVM_AUTO_USE=true

# History

HISTSIZE=100000
SAVEHIST=$HISTSIZE
# Comes from OMZ/lib/history.zsh
HIST_STAMPS="%F %T "

setopt append_history         # apppend to the history file across all shells
setopt inc_append_history     # write to the history file immediately, not when the shell exits

function .bind-history-substring-search-keys() {
  bindkey "$terminfo[kcuu1]" history-substring-search-up
  bindkey "$terminfo[kcud1]" history-substring-search-down
  bindkey '^[[A' history-substring-search-up
  bindkey '^[[B' history-substring-search-down
}

function .execute-post-zsh-defer() {
  .bind-history-substring-search-keys
  _zsh_autosuggest_bind_widgets
}

source "${zpm_dir}/zpm.zsh" 2>/dev/null || {
  local zpm_git_url="https://github.com/marcusrbrown/zpm"
  git clone --depth 1 "$zpm_git_url" "$zpm_dir"
  source "${zpm_dir}/zpm.zsh"
}

# Load plugins that are used by everything else
zpm load \
  marcusrbrown/zlugger \
  @omz

zpm load \
  @omz/lib/clipboard \
  @omz/lib/compfix \
  @omz/lib/completion \
  @omz/lib/correction \
  @omz/lib/directories \
  @omz/lib/functions \
  @omz/lib/git \
  @omz/lib/history \
  @omz/lib/key-bindings \
  @omz/lib/misc \
  @omz/lib/termsupport \
  @omz/lib/theme-and-appearance

zpm load \
  @omz/git \
  @omz/ssh-agent \

zpm load \
  chr-fritz/docker-completion.zshplugin,source:docker-completion.plugin.zsh,async \
  zpm-zsh/ssh,async \
  zsh-users/zsh-completions,apply:fpath,fpath:src,async \
  lukechilds/zsh-better-npm-completion,async \
  romkatv/zsh-defer,async \
  lukechilds/zsh-nvm,async \
  zdharma/history-search-multi-word,fpath:/,async \
  zdharma/fast-syntax-highlighting,async \
  zsh-users/zsh-autosuggestions,source:$generated,hook:"@zlug-from-zsh-defer-source zsh-autosuggestions.zsh > $generated",async \
  zsh-users/zsh-history-substring-search,source:$generated,hook:"@zlug-from-zsh-defer-source zsh-history-substring-search.zsh > $generated",async \
  @exec/.execute-post-zsh-defer,origin:'<<<"zsh-defer -c .execute-post-zsh-defer"',async

# Key bindings

bindkey '^[[1;9D' backward-word
bindkey '^[[1;9C' forward-word

# Aliases

# ~/.dotfiles is a bare Git repo with the work directory set to ~
alias .dotfiles='GIT_DIR=$HOME/.dotfiles'

alias ls='lsd -F'

# From OMZ
alias lsa='ls -lah'
alias l='ls -lah'
alias ll='ls -lh'
alias la='ls -lAh'

# starship 🚀
eval "$(starship init zsh)"

source ~/.zshrc.local 2>/dev/null
