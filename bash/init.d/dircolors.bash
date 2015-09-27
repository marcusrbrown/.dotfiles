#!bash
#
# dircolors

# if the dircolors utility is available, set that up
__garbage __dircolors COLORS
__dircolors="$(type -P gdircolors dircolors | head -1)"
test -n "$__dircolors" && {
  COLORS=/etc/DIR_COLORS
  test -e "/etc/DIR_COLORS.$TERM"   && COLORS="/etc/DIR_COLORS.$TERM"
  test -e "$HOME/.dir_colors"       && COLORS="$HOME/.dir_colors"
  test ! -e "$COLORS"               && COLORS=
  eval `$__dircolors --sh "$COLORS"`
}
