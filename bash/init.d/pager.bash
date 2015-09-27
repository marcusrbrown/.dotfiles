#!bash
#
# PAGER environment setup.

if [ -n "$(command -v less)" ]; then
  PAGER="less"
  # Less PAGER opts: Clear screen to repaint, ignore case in searches w/no uppercase, use the long prompt,
  # output "raw" control chars, chop long lines, set horizonatal scroll amount to 4 characters
  LESS="-ciMrS -#4"
  # Less MANPAGER opts: Same as above except don't output "raw" control chars and squeeze multiple blank lines
  MANPAGER="less -ciRs -#4"
else
  PAGER=more
  MANPAGER=more
fi
export PAGER MANPAGER LESS

alias l=$PAGER
