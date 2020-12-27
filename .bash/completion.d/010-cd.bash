#!/usr/bin/env bash
#
# Completion for cd.

# This is based off of the _cd() provided in the bash-completion 1.1 package,
# but is written so that if _cd() is already defined, it is used instead.
type -t _cd >/dev/null && return

## This meta-cd function observes the CDPATH variable so that cd additionally
## completes on directories under those specified in CDPATH.

_cd()
{
  local IFS=$'\n' cur=`_get_cword` i j k

  ## try to allow variable completion
  if [[ "$cur" == ?(\\)\$* ]]; then
    COMPREPLY=( $( compgen -v -P '$' -- "${cur#?(\\)$}" ) )
    return 0
  fi

  compgen -f /non-existing-dir/ >/dev/null

  ## Use standard dir completion if no CDPATH or parameter starts with /, ./ or ../
  if [[ -z "${CDPATH:-}" || "$cur" == ?(.)?(.)/* ]]; then
    _filedir -d
    return 0
  fi

  local -r mark_dirs=$(_rl_enabled mark-directories && echo y)
  local -r mark_symdirs=$(_rl_enabled mark-symlinked-directories && echo y)

  ## we have a CDPATH, so loop on its contents
  for i in ${CDPATH//:/$'\n'}; do
    ## create an array of matched subdirs
    k="${#COMPREPLY[@]}"
    for j in $( compgen -d $i/$cur ); do
      if [[ ( $mark_symdirs && -h $j || $mark_dirs && ! -h $j ) && ! -d ${j#$i/} ]]; then
        j+="/"
      fi
      COMPREPLY[k++]=${j#$i/}
    done
  done

  _filedir -d

  if [[ ${#COMPREPLY[@]} -eq 1 ]]; then
    i=${COMPREPLY[0]}
    if [[ "$i" == "$cur" && $i != "*/" ]]; then
      COMPREPLY[0]="${i}/"
    fi
  fi

  return 0
}
if shopt -q cdable_vars; then
  complete -v -F _cd $nospace cd pushd
else
  complete -F _cd $nospace cd pushd
fi
