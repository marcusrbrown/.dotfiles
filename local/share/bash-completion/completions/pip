#!bash
#
# Based on https://github.com/jezdez/pycompletion/blob/master/pycompletion/bash/pip

_pip_completion()
{
  COMPREPLY=( $( COMP_WORDS="${COMP_WORDS[*]}" \
                 COMP_CWORD=$COMP_CWORD \
                 PIP_AUTO_COMPLETE=1 $1 ) )
} &&
complete $default -F _pip_completion pip
