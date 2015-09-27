#!bash
#
# ls

# Setup the options that are always passed to ls
# Print sizes in human-readable format; don't list groups.
LS_COMMON="-hG"

# Does ls support --color?
if (ls --color) &> /dev/null; then
  LS_COMMON="$LS_COMMON --color=auto"
else
  # No color, so put a slash at the end of directory names, etc. to differentiate.
  LS_COMMON="$LS_COMMON -F"
fi

# Ignore NTUSER.DAT files on Windows
if [[ "$HOST_OS" == "mingw" ]]; then
  LS_COMMON="$LS_COMMON -I NTUSER.DAT\* -I ntuser.dat\*"
fi

test -n "$LS_COMMON" &&
alias ls="command ls $LS_COMMON"
alias ll="ls -l"
alias la="ls -a"
alias lal="ll -a"
