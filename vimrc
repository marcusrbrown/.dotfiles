" ~/.vimrc
" vim:set ft=vim et tw=78 sw=2:

" Setup pathogen first (https://github.com/tpope/vim-pathogen).
set runtimepath+=$HOME/.vim/bundle/vim-pathogen
call pathogen#infect()
call pathogen#helptags()

set nocompatible
set autoread
set backspace=2		" allow backspacing over everything in insert mode
" Now we set some defaults for the editor
set textwidth=0		" Don't wrap words by default
set nobackup		" Don't keep a backup file
set viminfo='20,\"50	" read/write a .viminfo file, don't store more than
			" 50 lines of registers
set history=2000	" keep 2000 lines of command line history
set ruler		" show the cursor position all the time
set showcmd		" Show (partial) command in status line.
set showmatch		" Show matching brackets.
set ignorecase		" Do case insensitive matching
set incsearch		" Incremental search
set autowrite		" Automatically save before commands like :next and :make
set title

set encoding=utf-8

"colorscheme darkblue
"colorscheme vividchalk
set background=dark
colorscheme solarized
set tags=tags;

" Suffixes that get lower priority when doing tab completion for filenames.
" These are files we are not likely to want to edit or read.
set suffixes=.bak,~,.swp,.o,.info,.aux,.log,.dvi,.bbl,.blg,.brf,.cb,.ind,.idx,.ilg,.inx,.out,.toc

" We know xterm-debian is a color terminal
if &term =~ "xterm-debian" || &term =~ "xterm-xfree86"
  set t_Co=16
  set t_Sf=[3%dm
  set t_Sb=[4%dm
endif

" mrbrown: Fix the Home/End keys in vim (from http://www.mingw.org/wiki/Configure_RXVT)
map <Esc>[7~ <Home>
map <Esc>[8~ <End>
imap <Esc>[7~ <Home>
imap <Esc>[8~ <End>

" Vim5 comes with syntaxhighlighting. If you want to enable syntaxhightlighting
" by default uncomment the next three lines.
if has("syntax")
  syntax on		" Default to no syntax highlightning e
endif

set listchars=tab:·\ ,trail:-,extends:>,precedes:<,nbsp:+  "show trailing whiteshace and tabs
set list                                                   "show unprintable chars by default

" Debian uses compressed helpfiles. We must inform vim that the main
" helpfiles is compressed. Other helpfiles are stated in the tags-file.
"set helpfile=$VIMRUNTIME/doc/help.txt.gz

if has("autocmd")

  filetype plugin indent on

  set fileformats=unix,dos,mac	" EOL formats in preferred order

  autocmd FileType text setlocal expandtab shiftwidth=4 tabstop=4 textwidth=78 smarttab
  autocmd FileType c set formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType cpp set formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType d set formatoptions=croql cindent comments=sr:/*,mb:*,el:*/,:// sw=4 ts=4 smarttab
  autocmd FileType python set tabstop=4 shiftwidth=4 expandtab smarttab
  autocmd FileType lua set tabstop=4 shiftwidth=4 smarttab

  augroup bzip2
    " Remove all bzip2 autocommands
    au!

    " Enable editing of bzipped files
    "       read: set binary mode before reading the file
    "             uncompress text in buffer after reading
    "      write: compress file after writing
    "     append: uncompress file, append, compress file
    autocmd BufReadPre,FileReadPre        *.bz2 set bin
    autocmd BufReadPre,FileReadPre        *.bz2 let ch_save = &ch|set ch=2
    autocmd BufReadPost,FileReadPost      *.bz2 |'[,']!bunzip2
    autocmd BufReadPost,FileReadPost      *.bz2 let &ch = ch_save|unlet ch_save
    autocmd BufReadPost,FileReadPost      *.bz2 execute ":doautocmd BufReadPost " . expand("%:r")

    autocmd BufWritePost,FileWritePost    *.bz2 !mv <afile> <afile>:r
    autocmd BufWritePost,FileWritePost    *.bz2 !bzip2 <afile>:r

    autocmd FileAppendPre                 *.bz2 !bunzip2 <afile>
    autocmd FileAppendPre                 *.bz2 !mv <afile>:r <afile>
    autocmd FileAppendPost                *.bz2 !mv <afile> <afile>:r
    autocmd FileAppendPost                *.bz2 !bzip2 -9 --repetitive-best <afile>:r
  augroup END

else

  set autoindent		" always set autoindenting on

endif " has ("autocmd")

" Python
"au FileType python source ~/.vim/scripts/python.vim
"let python_highlight_all = 1

" vim: ts=8 sw=2
