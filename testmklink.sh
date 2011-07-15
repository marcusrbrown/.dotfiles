#!/bin/sh
#
# Check for the mklink cmd.exe command (Windows Vista/7+).
# Echoes the command to create a symbolic link using mklink if successful.
# Assumes it is executing under MSYS (MINGW32) or Cygwin.

#set -x

case "`uname -s`" in
  MINGW*)
    fslash="//"
    winpwd="pwd -W"
    ;;

  CYGW*)
    fslash="/"
    winpwd="cygpath -wa ."
    ;;

  *)
    echo "This script should only be run under MSYS or Cygwin."
    exit 1
    ;;
esac

mklink="cmd ${fslash}c mklink"
mklink_success="symbolic link created"

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

success=$($mklink ${fslash}d "$watmpl" "$watmpt" 2>/dev/null | grep "$mklink_success")
if [ -z "$success" ]; then
    rm -rf "$tmpt"
    exit 1
fi

rm -rf "$tmpl" "$tmpt"

echo $mklink
exit 0
