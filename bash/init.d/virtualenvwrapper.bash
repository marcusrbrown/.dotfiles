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
fi
