#!bash
#
# virtualenvwrapper initialization.

export VIRTUALENV_DISTRIBUTE=1
export VIRTUAL_ENV_DISABLE_PROMPT=1

__garbage VENVWRAPPERSH
VENVWRAPPERSH=$(type -P virtualenvwrapper.sh /usr/local/bin/virtualenvwrapper.sh | head -1)

if [[ -n "$VENVWRAPPERSH" && -z "$WORKON_HOME" ]]; then
  export WORKON_HOME="$HOME/.virtualenvs"
  source "$VENVWRAPPERSH"

  # This is a hack for virtualenv on Windows under MSYS. The virtualenv activate code will only install
  # `activate' (not the .bat) if it detects Cygwin by looking at OSTYPE. We set OSTYPE to "cygwin" when
  # executing mkvirtualenv so that virtualenv works properly from a MSYS shell.
  # "Copy function" trick taken from http://stackoverflow.com/a/1369211.
  if [[ "$HOST_OS" = "mingw" ]]; then
    eval "$(echo "orig_mkvirtualenv()"; declare -f mkvirtualenv | tail -n +2)"
    #unset -f mkvirtualenv
    function mkvirtualenv {
      OSTYPE=cygwin orig_mkvirtualenv "$@"
    }
  fi
fi
