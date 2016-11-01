#!bash
#
# History settings

# Configure history settings only if the shell is interactive.
if [ -n "$INTERACTIVE" ]; then
  shopt -s histappend               # append history instead of overwriting it
  shopt -s cmdhist                  # save a multi-line command in a single history entry

  HISTSIZE=10000
  HISTFILESIZE=1000000000
  HISTCONTROL=ignoreboth
  HISTIGNORE="&:cd:ls:ll:la:lal:[bf]g:exit:clear:pwd"
  HISTTIMEFORMAT='%F %T '

  history_command="history -a; history -c; history -r"
  if [ -n "$(command -v __set_prompt_command)" ]; then
    __set_prompt_command "$history_command"
  else
    PROMPT_COMMAND="$history_command; $PROMPT_COMMAND"
  fi
fi
