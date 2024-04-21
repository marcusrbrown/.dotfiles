#!/usr/bin/env zsh
# shellcheck disable=SC1071

# XDG directories
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"

typeset -U {,F,MAN}PATH {,f,man}path
path=(
  $XDG_DATA_HOME/mise/shims(N-/)
  ~/.local/bin(N-/)
  $path
)
fpath=(
  $XDG_DATA_HOME/zsh/functions/*(N-/)
  $XDG_DATA_HOME/zsh/vendor-completions(N-/)
  $fpath
)

export ZDOTDIR="$XDG_CONFIG_HOME/zsh"

# If unset, then ZLE_REMOVE_SUFFIX_CHARS is ' \t\n;&|'; I don't want | included
ZLE_REMOVE_SUFFIX_CHARS=$' \t\n;&'

# vim: set ft=zsh:
