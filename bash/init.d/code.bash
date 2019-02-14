#!bash
#
# Visual Studio Code setup.

# Add the `code` command to the PATH
if [[ "$HOST_OS" == "darwin" ]]; then
  __set_path PATH "/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
fi
