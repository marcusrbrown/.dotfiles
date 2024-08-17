#!bash
#
# Homebrew setup

# Disable 'anonymous' analytics
export HOMEBREW_NO_ANALYTICS=1

# Remove previously installed versions of insalled/upgraded formulae
export HOMEBREW_INSTALL_CLEANUP=1

# Do not permit redirects from HTTPS to HTTP
export HOMEBREW_NO_INSECURE_REDIRECT=1

# Point to Homebrew's Python. Note that this must be installed in the PATH
# ahead of the system path to Python (usually /usr/bin/python).
__set_path PATH "/usr/local/opt/python/libexec/bin"
