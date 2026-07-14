#!/usr/bin/env zsh
# shellcheck disable=SC1071

source "$HOME/.config/bash/exports"

typeset -U {,F,MAN}PATH {,f,man}path
path=(
  $XDG_DATA_HOME/mise/shims(N-/)
  ~/.local/bin(N-/)
  $path
)

# Recover core functions when inherited FPATH entries are stale.
zsh_functions_dirs=(
  "$HOMEBREW_PREFIX/share/zsh/functions"
  "/usr/share/zsh/$ZSH_VERSION/functions"
  "/usr/share/zsh/functions"
)

fpath=(
  $XDG_DATA_HOME/zsh/functions/*(N-/)
  $XDG_DATA_HOME/zsh/vendor-completions(N-/)
  ${^fpath}(N-/)
  ${^zsh_functions_dirs}(N-/)
)
typeset -U fpath
unset zsh_functions_dirs

# vim: set ft=zsh:
