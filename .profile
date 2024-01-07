#!/usr/bin/env bash

# shellcheck disable=SC1091
source "$HOME/.config/bash/exports"

# Load interactive bash shell settings and utilities
if [ "$BASH" ]; then
  source "$HOME/.bashrc"
fi
