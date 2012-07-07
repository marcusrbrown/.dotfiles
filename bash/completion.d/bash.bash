#!bash
#
# Completions that can be handled within bash.

## Make directory commands see only directories
complete -d pushd

# User commands
complete -u write chfn groups slay w sux runuser

# Complete bg with stopped jobs
complete -A stopped -P '"%' -S '"' bg

# Other commands that take jobs
complete -j -P '"%' -S '"' fg jobs disown

# Complete readonly and unset with shell variables
complete -v readonly unset

# Complete set with set options
complete -A setopt set

# Complete shopt with shopt options
complete -A shopt shopt

## helptopics
complete -A helptopic help

# Complete unalias with aliases
complete -a unalias

# Complete bind with readline bindings
complete -A binding bind

# Complete type and which with commands
complete -c command type which

# Complete builtin with builtins
complete -b builtin
