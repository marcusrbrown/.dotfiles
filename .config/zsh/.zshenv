#!/usr/bin/env zsh
# shellcheck disable=SC1071

source "$HOME/.config/bash/exports"

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

# vim: set ft=zsh:
