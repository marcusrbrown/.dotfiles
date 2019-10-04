#!bash
#
# Based on https://github.com/jezdez/pycompletion/blob/master/pycompletion/bash/fabric

_fabric()
{
  local cur prev split=false

  COMPREPLY=()
  cur=`_get_cword`
  prev=${COMP_WORDS[COMP_CWORD-1]}
  _split_longopt && split=true

  case "$prev" in
    -c|--config|-f|--fabfile|-i)
      _filedir
      return 0
      ;;
  esac

  $split && return 0

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $( compgen -W '-a --no_agent -A --forward-agent \
      --abort-on-prompts -c --config= -d --display -n --connection-attempts= \
      -D --disable-known-hosts -f --fabfile= -F --list-format -h --help \
      --hide= -H --hosts= -x --exclude-hosts= -i -k --keepalive= --linewise \
      -l --list -p --password= -P --parallel --no-pty -r \
      --reject-unknown-hosts -R --roles= --set -s --shell= --shortlist \
      --show= --ssh-config-path --skip-bad-hosts -t --timeout= -u --user= \
      -V --version -w --warn-only -z --pool-size' \
      -- "$cur" ) )
  else
    CUSTOM_TASKS=`fab -l 2> /dev/null | awk 'NR>2{ print $1 }'`
    COMPREPLY=( $( compgen -W '$CUSTOM_TASKS' -- "$cur" ) )
  fi
} &&
complete -F _fabric fab
