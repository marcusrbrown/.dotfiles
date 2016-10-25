#!bash
#
# Prompt

# docker-machine prompt support based off of:
# https://github.com/docker/machine/blob/master/contrib/completion/bash/docker-machine-prompt.bash
# Configuration:
#
# DOCKER_MACHINE_PS1_SHOWSTATUS
#   When set, the machine status is indicated in the prompt. This can be slow,
#   so use with care.

# Only set the prompt if the shell is interactive.
# The bash-complete function will set BASH_COMPLETE_INVOKE to prevent the prompt from being set;
# this is so it can detect the output of shell completion.
if [ -n "$INTERACTIVE" -a -z "$BASH_COMPLETE_INVOKE" ]; then
  # Colors defined by the Solarized color scheme.
  #__garbage NO_COLOR RED ORANGE GREEN YELLOW BLUE MAGENTA VIOLET CYAN WHITE
  NO_COLOR='\033[00m'
  RED='\033[00;31m'
  ORANGE='\033[01;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[00;34m'
  MAGENTA='\033[00;35m'
  VIOLET='\033[01;35m'
  CYAN='\033[00;36m'
  WHITE='\033[01;37m'

  PATH_COLOR=$YELLOW
  HOST_COLOR=$VIOLET

  function __prompt()
  {
    local cwd=${PWD/$HOME/\~}

    if [ -z "$1" ]; then
      echo -e -n "$(__prompt title)\n$(__prompt host):$(__prompt path)$(__prompt git)$(__prompt venv)"
      echo -e -n "$(__prompt docker-machine " $BLUE{%s}$NO_COLOR")"
      echo
    fi

    case "$1" in
      title)
        echo -ne "\033]0;$HOSTNAME:$cwd\007"
        ;;

      path)
        local path=$cwd
        if [ ${#path} -gt 40 ]; then
          local d=$(basename "$path")
          path=$(dirname "$path")
          local i=$[ ${#path} - 40 ]
          path=...${path:$i}/$d
        fi
        echo -ne "${PATH_COLOR}${path}${NO_COLOR}"
        ;;

      host)
        local user=${USER:-$USERNAME}
        local host=${HOSTNAME%%.*}
        echo -ne "${HOST_COLOR}${user}@${host}${NO_COLOR}"
        ;;

      time)
        echo -ne "[${GREEN}$(date +"%R")${NO_COLOR}]"
        ;;

      git)
        # From bronson's dotfiles:
        local STATE_COLOR=$WHITE
        local unclean_state="${STATE_COLOR}*"
        local changes_to_push="${STATE_COLOR}↑"
        local changes_to_pull="${STATE_COLOR}↓"
        local changes_to_push_and_pull="${STATE_COLOR}↕"

        local git_status="$(git status 2> /dev/null)"
        local branch_pattern="^(# )?On branch ([[:graph:]]*)"
        local remote_pattern="(# )?Your branch is (.*) of"
        local diverge_pattern="(# )?Your branch and (.*) have diverged"
        local clean_pattern="working (directory|tree) clean"

        if [[ ! ${git_status} =~ ${clean_pattern} ]]; then
          local state="$unclean_state"
        fi

        # add an else if or two here if you want to get more specific
        if [[ ${git_status} =~ ${remote_pattern} ]]; then
          if [[ ${BASH_REMATCH[2]} == "ahead" ]]; then
            local remote="$changes_to_push"
          else
            local remote="$changes_to_pull"
          fi
        fi
        if [[ ${git_status} =~ ${diverge_pattern} ]]; then
          local remote="$changes_to_push_and_pull"
        fi
        if [[ ${git_status} =~ ${branch_pattern} ]]; then
          local branch=${BASH_REMATCH[2]}
          local git_branch=" (${branch})${remote}${state}"
        fi

        echo -ne "${MAGENTA}${git_branch}${NO_COLOR}"
        ;;

      venv)
        # From mitsuhiko's dotfiles:
        local ENV_NAME
        local folder
        if [ x"$VIRTUAL_ENV" != x ]; then
          if [[ "$VIRTUAL_ENV" == *.virtualenvs/* || "$VIRTUAL_ENV" == *.virtualenvs\\* ]]; then
            ENV_NAME=`basename "${VIRTUAL_ENV}"`
          else
            folder=`dirname "${VIRTUAL_ENV}"`
            ENV_NAME=`basename "$folder"`
          fi
          echo -ne " ${WHITE}workon ${GREEN}${ENV_NAME}${NO_COLOR}"
        fi
        ;;

      docker-machine)
        shift
        local format=${1:- [%s]}
        if test ${DOCKER_MACHINE_NAME}; then
          local status
          if test ${DOCKER_MACHINE_PS1_SHOWSTATUS:-false} = true; then
            status=$(docker-machine status ${DOCKER_MACHINE_NAME})
            case ${status} in
              Running)
                status=' R'
                ;;
              Stopping)
                status=' R->S'
                ;;
              Starting)
                status=' S->R'
                ;;
              Error|Timeout)
                status=' E'
                ;;
              *)
                # Just consider everything elase as 'stopped'
                status=' S'
                ;;
            esac
          fi
          printf -- "${format}" "${DOCKER_MACHINE_NAME}${status}"
        fi
        ;;

      color)
        local color
        if [ $__prompt_status -eq 0 ]; then
          color="${NO_COLOR}"
        else
          color="${RED}"
        fi
        echo -ne "$color"
        ;;
    esac
  }

  PROMPT_COMMAND="__prompt_status=\$?; history -a; __prompt"
  PS1="\[\$(__prompt color)\]\$\[${NO_COLOR}\] "
fi
