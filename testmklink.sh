#!/bin/sh
#
# Check for the mklink cmd.exe command (Windows Vista/7+).
# Echoes the command to create a symbolic link using mklink if successful.
# Assumes it is executing under MSYS (MINGW32) or Cygwin.

#set -x

# TODO: Does Cygwin need different escaping?
mklink="cmd //c mklink"
mklink_success="symbolic link created"
# TODO: Does Cygwin support `pwd -W`? If not, use cygpath instead.
winpwd="pwd -W"

# Create a temporary directory and try to make a link to it.
tmpt=`mktemp -q -d -p $TMP` || exit 1
tmpl=`mktemp -q -d -p $TMP`
if [ $? -ne 0 ]; then
    rm -rf "$tmpt"
    exit 1
fi

watmpt=$(cd "$tmpt" && $winpwd | sed 's/\//\\/g')
watmpl=$(cd "$tmpl" && $winpwd | sed 's/\//\\/g')
rm -rf "$tmpl"

success=$($mklink //d "$watmpl" "$watmpt" 2>NUL | grep "$mklink_success")
if [ -z "$success" ]; then
    rm -rf "$tmpt"
    exit 1
fi

rm -rf "$tmpl" "$tmpt"

echo $mklink
exit 0
