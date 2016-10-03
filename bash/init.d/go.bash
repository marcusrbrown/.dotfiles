#!bash
#
# Go setup.

export GOPATH="$HOME/go"

[[ -d "$GOPATH/bin" ]] && export PATH="$PATH:$GOPATH/bin"
