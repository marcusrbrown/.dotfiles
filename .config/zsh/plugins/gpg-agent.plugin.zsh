#!/usr/bin/env zsh
# shellcheck disable=SC1071

# Ensure the passphrase prompt is shown in the correct tty
function _gpg-agent_update-tty_preexec {
  gpg-connect-agent updatestartuptty /bye &>/dev/null
}

autoload -U add-zsh-hook
add-zsh-hook preexec _gpg-agent_update-tty_preexec
