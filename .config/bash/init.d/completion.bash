#!bash
#
# Command completion

if [ -z "${BASH_COMPLETION_COMPAT_DIR}" -a -d /usr/local/etc/bash_completion.d ]; then
  export BASH_COMPLETION_COMPAT_DIR="/usr/local/etc/bash_completion.d"
fi

# Only source completion if the shell is interactive.
if [ -n "$INTERACTIVE" ]; then
  bash=${BASH_VERSION%.*}; bmajor=${bash%.*}; bminor=${bash#*.}
  if [ $bmajor -gt 1 -a -z "${BASH_COMPLETION_VERSINFO-}" ]; then
    # Search for a bash_completion file to source.
    for f in /usr/local/etc/profile.d/bash_completion.sh \
             /usr/local/etc/bash_completion \
             /usr/pkg/etc/bash_completion \
             /opt/local/etc/bash_completion \
             /usr/share/bash-completion/bash_completion \
             /etc/bash_completion
    do
      if [ -r $f ]; then
        . $f
        break
      fi
    done
  fi
  unset bash bmajor bminor

  if [ -z "${BASH_COMPLETION_VERSINFO-}" -a -z "${BASH_COMPLETION}" ]; then
    # Source the Homebrew bash_completion if a system-wide version wasn't used.
    [ -n "$(command -v brew)" ] && [ -f $(brew --prefix)/etc/bash_completion ] && . $(brew --prefix)/etc/bash_completion
  fi

  if [ -z "${BASH_COMPLETION_VERSINFO-}" -a -z "${BASH_COMPLETION}" ]; then
    # If there's no system-wide bash_completion, source the user one ourselves.
    [ -f ~/.bash_completion ] && . ~/.bash_completion
  fi
fi
