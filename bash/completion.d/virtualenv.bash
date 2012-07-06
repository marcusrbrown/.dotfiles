#!bash
#
# Based on https://github.com/jezdez/pycompletion/blob/master/pycompletion/bash/virtualenv

_virtualenv()
{
  local cur prev split=false

  COMPREPLY=()
  cur=`_get_cword`
  prev=${COMP_WORDS[COMP_CWORD-1]}

  _split_longopt && split=true

  case "$prev" in
    -p|--python)
      _filedir
      return 0
      ;;
  esac

  $split && return 0

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $( compgen -W '-v --verbose -q --quiet -p --python= --clear \
      --no-site-packages --system-site-packages --unzip-setuptools \
      --relocatable --distribute --use-distribute --extra-search-dir= \
      --never-download --prompt -h --help --version' \
      -- "$cur" ) )
    return 0
  fi

  return 0
} &&
complete -F _virtualenv $default virtualenv virtualenv.py
