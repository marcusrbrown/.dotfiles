#!/usr/bin/env bash

LESSKEY=${LESSKEY:-"$XDG_CONFIG_HOME/less/lesskey"}

lesskey -o "$LESSKEY" ./input
