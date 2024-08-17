#!/usr/bin/env bash

# Abort if not running interactively
[[ $- == *i* ]] || return 0

eval \
  "$(sheldon --config-file="$XDG_CONFIG_HOME"/sheldon/plugins.bash.toml --data-dir="$XDG_DATA_HOME"/sheldon/bash source)"
