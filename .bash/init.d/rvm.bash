#!bash
#
# rvm setup

RVM_HOME="$HOME/.rvm"

__set_path PATH "$RVM_HOME" # Add RVM to PATH for scripting

[[ -s "$RVM_HOME/scripts/rvm" ]] && source "$RVM_HOME/scripts/rvm" # Load RVM into a shell session *as a function*

# Enable completion.
[[ -r $rvm_path/scripts/completion ]] && . $rvm_path/scripts/completion
