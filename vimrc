" ~/.vimrc
" vim:set ft=vim et tw=78 sw=2:

set nocompatible

" Setup pathogen first (https://github.com/tpope/vim-pathogen).
" Pathogen itself is kept in a subrepo.
runtime bundle/vim-pathogen/autoload/pathogen.vim
if exists('g:loaded_pathogen')
  call pathogen#infect()
  call pathogen#helptags()
endif

set encoding=utf-8

set backspace=indent,eol,start " Allow backspacing over indents, line start and end
set textwidth=0         " Don't wrap words by default
set nobackup            " Don't keep a backup file
set viminfo='20,\"50    " read/write a .viminfo file, don't store more than
                        " 50 lines of registers
set history=2000        " keep 2000 lines of command line history
set ruler               " show the cursor position all the time
set showcmd             " Show (partial) command in status line.
set showmatch           " Show matching brackets.
set ignorecase          " Do case insensitive matching
set incsearch           " Incremental search
set autowrite           " Automatically save before commands like :next and :make
set autoread            " Reread files that have changed
set laststatus=2        " Always show the status bar
set notitle             " No thanks, Vim

" Look for Vim modelines at the top or bottom of files, and look at least 6
" lines in (past a copyright header, etc.).
set modeline
set modelines=6

" Tabs, whitespace, and folding
set tabstop=4
set shiftwidth=4
set softtabstop=4
" Turn off autoident, smart indent, and C indent (enabled by file type)
set noautoindent
set nosmartindent
set nocindent
set smarttab
set expandtab
set nowrap
set list
set listchars=tab:→\ ,trail:·,nbsp:·
set foldmethod=indent
set nofoldenable        " Don't close folds by default

set background=dark
colorscheme solarized

set tags=tags;

" Suffixes that get lower priority when doing tab completion for filenames.
" These are files we are not likely to want to edit or read.
set suffixes=.bak,~,.swp,.o,.info,.aux,.log,.dvi,.bbl,.blg,.brf,.cb,.ind,.idx,.ilg,.inx,.out,.toc

" mrbrown: Fix the Home/End keys in vim (from http://www.mingw.org/wiki/Configure_RXVT)
map <Esc>[7~ <Home>
map <Esc>[8~ <End>
imap <Esc>[7~ <Home>
imap <Esc>[8~ <End>

syntax on

if has("autocmd")

  filetype plugin indent on

  set fileformats=unix,dos,mac	" EOL formats in preferred order

  autocmd FileType text setlocal expandtab shiftwidth=4 tabstop=4 textwidth=78 smarttab
  autocmd FileType c set formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType cpp set formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType d set formatoptions=croql cindent comments=sr:/*,mb:*,el:*/,:// sw=4 ts=4 smarttab

  autocmd FileType python set tabstop=4 shiftwidth=4 softtabstop=4 expandtab smarttab
  autocmd FileType python set textwidth=79

  autocmd FileType lua set tabstop=4 shiftwidth=4 smarttab

  augroup myvimrchooks
    autocmd!
    " Source vimrc after saving it
    autocmd BufWritePost .vimrc,vimrc,.gvimrc,gvimrc source $MYVIMRC | if has('gui_running') | source $MYGVIMRC | endif
  augroup END
endif " has ("autocmd")

set statusline=%<%f\ (%{&ft})\ %-4(%m%)%=%-19(%3l,%02c%03V%)
