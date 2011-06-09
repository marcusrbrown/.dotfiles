# source the system wide bashrc if it exists
if [ -e /etc/bash.bashrc ] ; then
  source /etc/bash.bashrc
fi

# source the users bashrc if it exists
if [ -e "${HOME}/.bashrc" ] ; then
  source "${HOME}/.bashrc"
fi

# set PATH so it includes user's private bin if it exists
if [ -d ~/bin ] ; then
    PATH=~/bin:${PATH}
fi

umask 066

#export TERM=rxvt-cygwin-native
# Needed for rxvt/vim/etc. under MSYS
export TERM=msys

# Python to use.
#export PYTHON=/cygdrive/c/Python26/python.exe

# Make sure Python output is always unbuffered (needed for Win32 Pythons).
export PYTHONUNBUFFERED=x
