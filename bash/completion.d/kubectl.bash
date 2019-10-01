#!/usr/bin/env bash
#
# Completions for kubectl

__garbage __kubectl
__kubectl=$(type -P kubectl)
[ -x "${__kubectl}" ] && source <(${__kubectl} completion bash)
