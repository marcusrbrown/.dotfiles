#!bash
#
# virtualenvwrapper initialization.

export VIRTUALENV_DISTRIBUTE=1
export VIRTUAL_ENV_DISABLE_PROMPT=1

__garbage VENVWRAPPERSH
VENVWRAPPERSH=$(type -P virtualenvwrapper.sh /usr/local/bin/virtualenvwrapper.sh | head -1)

if [[ -n "$VENVWRAPPERSH" ]]; then
  if [[ -z "$WORKON_HOME" ]]; then
    export WORKON_HOME="$HOME/.virtualenvs"
  else
    # Make sure the directory is in a format compatible with the shell.
    export WORKON_HOME="$(cd "$WORKON_HOME" && pwd)"
  fi
  source "$VENVWRAPPERSH"

  # Preserve the directory we were in before mkvirtualenv is called. Use this
  # to determine whether or not we were in a directory named "Projects". If we
  # are, supply this directory to mkvirtualenv.
  # "Copy function" trick taken from http://stackoverflow.com/a/1369211.
  eval "$(echo "orig_mkvirtualenv()"; declare -f mkvirtualenv | tail -n +2)"
  function mkvirtualenv {
    MKVIRTUALENV_PWD="$(pwd)" orig_mkvirtualenv "$@"
  }
fi
