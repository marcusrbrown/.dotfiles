#!/usr/bin/env bash
#
# Setup Nix

: ${NIX_PROFILE_PATH:="$HOME/.nix-profile/etc/profile.d"}

if [ -e "${NIX_PROFILE_PATH}/nix.sh" ]; then . "${NIX_PROFILE_PATH}/nix.sh"; fi
