# shellcheck shell=bash source=/dev/null

# Fig pre block. Keep at the top of this file.
[[ -f "$HOME/.fig/shell/bash_profile.pre.bash" ]] && builtin source "$HOME/.fig/shell/bash_profile.pre.bash"

# Lood shared shell configuration
[ -n "$SHPROFILE_LOADED" ] || source ~/.shprofile

source ~/.bash_profile.local 2>/dev/null || true

# Fig post block. Keep at the bottom of this file.
[[ -f "$HOME/.fig/shell/bash_profile.post.bash" ]] && builtin source "$HOME/.fig/shell/bash_profile.post.bash"
