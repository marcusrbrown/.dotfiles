#!/usr/bin/env zsh

# Go

export GOPATH="${HOME}/go"
export GOROOT
if (( $+commands[go] )); then
  : ${GOROOT:=$(go env GOROOT)}
elif (( $+commands[brew] )) && [[ -d "$(brew --prefix golang)/libexec" ]]; then
  : ${GOROOT:=$(brew --prefix golang)/libexec}
elif [[ -d /usr/local/go ]]; then
  : ${GOROOT:=/usr/local/go}
fi
test -d "$GOPATH" || mkdir -p "$GOPATH"
test -d "$GOPATH/src/github.com" || mkdir -p "$GOPATH/src/github.com"

PATH="${PATH}:${GOPATH}/bin:${GOROOT}/bin"

# Ruby

if (( $+commands[brew] )) && [[ -d "$(brew --prefix ruby)/bin" ]]; then
  PATH="$(brew --prefix ruby)/bin:${PATH}"
fi

# Pagers

if (( $+commands[bat] )); then
  MANPAGER="sh -c 'col -bx | bat -l man --style=grid --pager \"less -R -M -i +Gg\"'"
  MANROFFOPT='-c'
  export MANPAGER MANROFFOPT
fi

# Long options: --quit-if-one-screen --LONG-PROMPT --RAW-CONTROL-CHARS --chop-long-lines --ignore-case
export LESS="-F -M -R -S -i"

# Local tools and utilities
PATH="${HOME}/.local/bin:$PATH"

export PATH

source ~/.zshenv.local 2>/dev/null || true
