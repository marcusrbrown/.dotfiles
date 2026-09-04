#!/usr/bin/env bash

# Abort if not running interactively
[[ $- == *i* ]] || return 0

declare -F command_exists >/dev/null 2>&1 || source "${XDG_CONFIG_HOME:-$HOME/.config}/bash/exports"
source "${XDG_CONFIG_HOME:-$HOME/.config}/bash/aliases"

eval \
  "$(sheldon --config-file="$XDG_CONFIG_HOME"/sheldon/plugins.bash.toml --data-dir="$XDG_DATA_HOME"/sheldon/bash source)"
