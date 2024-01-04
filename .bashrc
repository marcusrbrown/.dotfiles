# shellcheck shell=bash source=/dev/null

# Fig pre block. Keep at the top of this file.
[[ -f "$HOME/.fig/shell/bashrc.pre.bash" ]] && builtin source "$HOME/.fig/shell/bashrc.pre.bash"

# check if this is a login shell
[ "$0" = "-bash" ] && export LOGIN_BASH=1

# run bash_profile if this is not a login shell
[ -z "$LOGIN_BASH" ] && source ~/.bash_profile

source ~/.shrc

# Fig post block. Keep at the bottom of this file.
[[ -f "$HOME/.fig/shell/bashrc.post.bash" ]] && builtin source "$HOME/.fig/shell/bashrc.post.bash"
