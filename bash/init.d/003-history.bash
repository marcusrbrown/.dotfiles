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

  PROMPT_COMMAND="__prompt_status=\$?; history -a; __prompt"
fi
