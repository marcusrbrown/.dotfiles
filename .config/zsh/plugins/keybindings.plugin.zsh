#!/usr/bin/env zsh
# shellcheck disable=SC1071

# Key bindings
export KEYTIMEOUT=1

stty intr '^C'                 # Ctrl-C
stty susp '^Z'                 # Ctrl-Z
stty stop undef                # Ctrl-S

# Use emacs key bindings even if our EDITOR is set to vi
bindkey -e

bindkey -s '^[[32;2u' ' '

# [Home] - Move to the beginning of the line
bindkey '^[[H'    beginning-of-line
bindkey '^[[1~'   beginning-of-line
bindkey '^[[7~'   beginning-of-line

# [End] - Move to the end of the line
bindkey '^[[F'    end-of-line
bindkey '^[[4~'   end-of-line
bindkey '^[[8~'   end-of-line

# [Ctrl-Left] - Move one word backward
bindkey '^[[1;5D' backward-word
bindkey '^[[1;9D' backward-word

# [Ctrl-Right] - Move one word forward
bindkey '^[[1;5C' forward-word
bindkey '^[[1;9C' forward-word

# [Backspace] - Delete the character before the cursor
bindkey '^?'      backward-delete-char
bindkey '^H'      backward-delete-char

# [Delete] - Delete the character under the cursor
bindkey '^[[3~'   delete-char

# [Ctrl-Delete] - Delete the word under the cursor
bindkey '^[[3;5~' kill-word

# [Shift-Tab] - Move to the previous completion
zmodload zsh/complist
bindkey '^[[Z'    reverse-menu-complete
# zsh-utils/editor runs `bindkey -d` at source time, which destroys the
# `menuselect` keymap (created by zsh/complist) and wipes the main-keymap bind
# below. A plain `zmodload zsh/complist` is a no-op once the module is loaded, so
# it cannot recreate the keymap. Repair at the first precmd: reload complist to
# recreate `menuselect`, then re-apply both binds.
_keybindings_bind_menuselect() {
  if ! bindkey -l menuselect >/dev/null 2>&1; then
    zmodload -u zsh/complist 2>/dev/null && zmodload zsh/complist 2>/dev/null
    bindkey -l menuselect >/dev/null 2>&1 || bindkey -N menuselect
  fi
  bindkey '^[[Z' reverse-menu-complete
  bindkey -M menuselect '^[[Z' reverse-menu-complete
  add-zsh-hook -d precmd _keybindings_bind_menuselect
  unfunction _keybindings_bind_menuselect
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _keybindings_bind_menuselect

# Edit the command line in $EDITOR
autoload -U edit-command-line
zle -N edit-command-line
bindkey '^x^e'    edit-command-line
bindkey '^xe'     edit-command-line

# From @OMZL::key-bindings
bindkey '\ew' kill-region                           # [Esc-w] - Kill from the cursor to the mark
bindkey '^r' history-incremental-search-backwards   # [Ctrl-r] - search history backwards
bindkey ' ' magic-space                             # [Space] - do history expansion
