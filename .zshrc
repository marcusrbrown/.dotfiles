#export DEBUG=zpm

local cache_dir="${XDG_CACHE_HOME:-${HOME}/.cache}"
local config_dir="${XDG_CONFIG_HOME:-${HOME}/.config}"

local zpm_cache_dir="${cache_dir}/zpm"
local zpm_dir="${zpm_cache_dir}/zpm"
: ${_ZPM_CACHE_DIR:="${TMPDIR:-/tmp}/zsh-${UID:-user}"}

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

function .bind-history-substring-search-keys() {
  bindkey "$terminfo[kcuu1]" history-substring-search-up
  bindkey "$terminfo[kcud1]" history-substring-search-down
  bindkey '^[[A' history-substring-search-up
  bindkey '^[[B' history-substring-search-down
}

function .execute-post-zsh-defer() {
  echo start
  .bind-history-substring-search-keys
  _zsh_autosuggest_bind_widgets
  echo finish
}

if [[ ! -r "${zpm_dir}/zpm.zsh" ]]; then
  local zpm_git_url="https://github.com/zpm-zsh/zpm"
  git clone --depth 1 "$zpm_git_url" "$zpm_dir"
fi

source "${zpm_dir}/zpm.zsh"

# Load plugins that are used by everything else
zpm load \
  marcusrbrown/zlugger \
  @omz,gen-plugin:'<<<"export ZSH=${(q)Plugin_path}"; cat oh-my-zsh.sh'

zpm load \
  chr-fritz/docker-completion.zshplugin,source:docker-completion.plugin.zsh,async \
  zpm-zsh/ssh,async \
  zpm-zsh/zpm-link,async \
  zsh-users/zsh-completions,apply:fpath,fpath:src,async \
  @omz/git,async \
  lukechilds/zsh-better-npm-completion,async \
  romkatv/zsh-defer,async \
  lukechilds/zsh-nvm,async \
  zdharma/history-search-multi-word,fpath:/,async \
  zdharma/fast-syntax-highlighting,async \
  zsh-users/zsh-autosuggestions,gen-plugin:"@zlug-from-zsh-defer-source zsh-autosuggestions.zsh",async \
  zsh-users/zsh-history-substring-search,gen-plugin:"@zlug-from-zsh-defer-source zsh-history-substring-search.zsh",async \
  @empty/.execute-post-zsh-defer,type:empty,gen-plugin:'<<<"zsh-defer -c .execute-post-zsh-defer"',async

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

[[ -r ~/.zshrc.local ]] && source ~/.zshrc.local || true
