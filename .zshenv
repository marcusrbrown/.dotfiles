#!/usr/bin/env zsh

# Go

export GOPATH="${HOME}/go"
export GOROOT
if (( $+commands[go] )); then
  : ${GOROOT:=$(go env GOROOT)}
elif (( $+commands[brew] )); then
  : ${GOROOT:=$(brew --prefix golang)/libexec}
else
  : ${GOROOT:=/usr/local/go}
fi
test -d "$GOPATH" || mkdir -p "$GOPATH"
test -d "$GOPATH/src/github.com" || mkdir -p "$GOPATH/src/github.com"

PATH="${PATH}:${GOPATH}/bin:${GOROOT}/bin"

# Homebrew

# Disable 'anonymous' analytics
export HOMEBREW_NO_ANALYTICS=1
# Remove previously installed versions of insalled/upgraded formulae
export HOMEBREW_INSTALL_CLEANUP=1
# Do not permit redirects from HTTPS to HTTP
export HOMEBREW_NO_INSECURE_REDIRECT=1

# Pagers

(( $+commands[bat] )) && export \
  MANPAGER="sh -c 'col -bx | bat -l man --style=grid --pager \"less -R -M -i +Gg\"'" \
  MANROFFOPT='-c'

# Long options: --quit-if-one-screen --LONG-PROMPT --RAW-CONTROL-CHARS --chop-long-lines --ignore-case
export LESS="-F -M -R -S -i"

source ~/.zshenv.local 2>/dev/null
