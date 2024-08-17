#!bash
#
# Setup the .NET version manager

DNX_USER_HOME="$HOME/.dnx"

__set_path PATH "$DNX_USER_HOME/bin"

[ -s "$DNX_USER_HOME/dnvm/dnvm.sh" ] && . "$DNX_USER_HOME/dnvm/dnvm.sh" # Load dnvm
