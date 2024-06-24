#!/usr/bin/env zsh
# shellcheck disable=SC1071

export ZDOTDIR="${XDG_CONFIG_HOME:-~/.config}/zsh"

if [ -f "${ZDOTDIR}/.zshenv" ]; then
  source "${ZDOTDIR}/.zshenv"
fi

# vim: set ft=zsh:
