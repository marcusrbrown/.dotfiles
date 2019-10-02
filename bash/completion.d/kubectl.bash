#!/usr/bin/env bash
#
# Completions for kubectl

__kubectl=$(type -P kubectl)
[ -x "${__kubectl}" ] && source <(${__kubectl} completion bash)
unset __kubectl
