# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files for examples


# Are we running under msys? If so, the terminal, prompt, and a few other settings need to be set differently.
if [ "$MSYSTEM" -a "$MSYSCON" ]; then
    MSYS="MSYS"
else
    MSYS=""
fi


# Completion options
# ##################

# If this shell is interactive, turn on programmable completion enhancements.
# Any completions you add in ~/.bash_completion are sourced last.
case $- in
   *i*) [[ -f /etc/bash_completion ]] && . /etc/bash_completion ;;
esac


# History Options
# ###############

# Don't put duplicate lines in the history.
export HISTCONTROL="ignoredups"

# Ignore some controlling instructions
export HISTIGNORE="[   ]*:&:bg:fg:exit"

# Whenever displaying the prompt, write the previous line to disk
export PROMPT_COMMAND="history -a"

# If running interactively, then:
if [ "$PS1" ]; then
    # set a fancy prompt
    if [ "$TERM" = "xterm" -o "$TERM" = "rxvt" ]; then
        if [ "$MSYS" ]; then
            TITLEBAR='\[\033]0;$MSYSTEM:\u@\h:\w\007\]'
        else
            TITLEBAR='\[\033]0;\u@\h:\w\007\]'
        fi
    else
        TITLEBAR=''
    fi
    if [ "$MSYS" ]; then
        PROMPTSTR='\033[32m\]\u@\h \[\033[33m\w\033[0m\]$ '
    else
        PROMPTSTR='\u@\h:\w\$ '
    fi
    PS1="${TITLEBAR}${PROMPTSTR}"
    unset TITLEBAR
fi

# Functions
# #########

# MRB 12/18/08: wpath and wcmd are taken from: http://mail.python.org/pipermail/python-list/2004-February/249054.html

#
# Function to pre-process first argument (skipping past options) of a command
# with cygpath to translate paths to for Windows tools.
#
function wpath {
    typeset -i cmdstart=1
    local cmd=""
    local args=""

    while arg=${*:$cmdstart:1} && [ "${arg:0:1}" == "-" ]; do
	cmdstart=cmdstart+1
    done

    if [ $# -ge $cmdstart ]; then
        cmd=`cygpath -w ${*:$cmdstart:1}`
	args=${*:$((cmdstart+1))}
    fi

    echo ${*:1:$((cmdstart-1))} $cmd $args
}

#
# Function used to execute a command with its first argument translated to
# windows compatible paths.
#
function wcmd {
    $1 `wpath ${*:2}`
}

# Aliases
# #######

# enable color support of ls and also add handy aliases
#eval `dircolors`
alias ls='ls --color=auto '
alias ll='ls -laF'
alias la='ls -A'
alias l='less'
alias dir='ls --color=auto --format=vertical'
alias vdir='ls --color=auto --format=long'

alias vimr='vim -R'

# Convert all files in the current directory to lowercase
alias tolower="for i in * ; do [ -f \$i ] && mv -i \$i \`echo \$i | tr '[A-Z]' '[a-z]'\`; done;"

# Run resize to update the current terminal window's dimensions.
if type resize &> /dev/null; then
    alias rs='eval `resize`'
else
    alias rs=true
fi

if [ "$MSYS" ]; then   
    alias clear=clsb
fi

export CVS_RSH=ssh
export IRCNAME="Marcus R. Brown"

# Options for less
LESS='-M-Q'
LESSEDIT="%E ?lt+%lt. %f"
LESSOPEN="| ${HOME}/bin/lesspipe %s"
LESSCHARDEF=8bcccbcc13b.4b95.33b. # show colours in ls -l | less
PAGER=less
export LESS LESSEDIT LESSOPEN LESSCHARDEF PAGER

INPUTRC=~/.inputrc
export INPUTRC

if [ -z $VIMRUNTIME ]; then
    if [ "$MSYS" ]; then
        export VIMRUNTIME=/usr/share/vim/vim72
    else
        export VIMRUNTIME=/usr/share/vim/vim73
    fi
fi

# ex: ts=4 sw=4 et filetype=sh
