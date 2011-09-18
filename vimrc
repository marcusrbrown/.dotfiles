" ~/.vimrc
" vim:set ft=vim et tw=78 sw=2:

set nocompatible
set viminfo='20,\"50    " read/write a .viminfo file, don't store more than
                        " 50 lines of registers

" gvim on Windows needs better paths.
if has('win32') && has('gui')
  set runtimepath=~/.vim,$VIMRUNTIME
  set viminfo+=n~/.viminfo
endif

" Setup pathogen first (https://github.com/tpope/vim-pathogen).
" Pathogen itself is kept in a subrepo.
runtime bundle/vim-pathogen/autoload/pathogen.vim
if exists('g:loaded_pathogen')
  call pathogen#infect()
  call pathogen#helptags()
endif

set encoding=utf-8
set fileencoding=utf-8

set backspace=indent,eol,start " Allow backspacing over indents, line start and end
set textwidth=0         " Don't wrap words by default
set nobackup            " Don't keep a backup file
set history=2000        " keep 2000 lines of command line history
set ruler               " show the cursor position all the time
set showcmd             " Show (partial) command in status line.
set showmatch           " Show matching brackets.
set ignorecase          " Do case insensitive matching
set incsearch           " Incremental search
set autowrite           " Automatically save before commands like :next and :make
set autoread            " Reread files that have changed

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

filetype plugin indent on

set fileformats=unix,dos,mac	" EOL formats in preferred order

augroup filebufcmds
  autocmd!

  autocmd FileType text setlocal expandtab shiftwidth=4 tabstop=4 textwidth=78 smarttab
  autocmd FileType c set formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType cpp set formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType d set formatoptions=croql cindent comments=sr:/*,mb:*,el:*/,:// sw=4 ts=4 smarttab

  autocmd FileType python set tabstop=4 shiftwidth=4 softtabstop=4 expandtab smarttab
  autocmd FileType python set textwidth=79
  " auto indent after "def foo():<CR>"
  autocmd BufRead python set smartindent cinwords=if,elif,else,for,while,try,except,finally,def,class,with
  " automatically strip trailing whitespace from Python scripts
  autocmd BufWritePre python normal m`:%s/\s\+$//e ``

  autocmd FileType lua set tabstop=4 shiftwidth=4 smarttab

  autocmd FileType sh setlocal tabstop=2 shiftwidth=2 expandtab smarttab

  autocmd FileType javascript setlocal tabstop=4 shiftwidth=4 softtabstop=4 noexpandtab

augroup END

augroup myvimrchooks
  autocmd!
  " Source vimrc after saving it
  autocmd BufWritePost .vimrc,vimrc,.gvimrc,gvimrc source $MYVIMRC | if has('gui_running') | source $MYGVIMRC | endif
augroup END

augroup vimrcEx
  autocmd!

  " When editing a file, always jump to the last known cursor position.
  " Don't do it when the position is invalid or when inside an event handler
  " (happens when dropping a file on gvim).
  " Also don't do it when the mark is in the first line, that is the default
  " position when opening a file.
  " Function and commit logic from https://github.com/chestone/homedir, which linked to:
  " http://structurallysoundtreehouse.com/my-almost-perfect-vim-files
  " http://github.com/fredlee/mydotfiles/tree/master
  " Also exclude certain git files (from the msysgit distribution).
  autocmd BufReadPost * call SetCursorPosition()
  function! SetCursorPosition()
    if &filetype !~ 'commit\c' && &filetype !~ 'svn\c'
      if line("'\"") > 1 && line("'\"") <= line("$")
            \ && expand("%") !~ "COMMIT_EDITMSG"
            \ && expand("%") !~ "ADD_EDIT.patch"
            \ && expand("%") !~ "addp-hunk-edit.diff"
            \ && expand("%") !~ "git-rebase-todo"
        exe "normal! g`\""
      endif
    end
  endfunction

  " From http://vimcasts.org/episodes/fugitive-vim-browsing-the-git-object-database/
  "
  " Go to the parent directory in a git tree or blob.
  autocmd User fugitive
    \ if fugitive#buffer().type() =~# '^\%(tree\|blob\)$' |
    \   nnoremap <buffer> .. :edit %:h<CR> |
    \ endif

  " Auto-clean fugitive buffers.
  autocmd BufReadPost fugitive://* set bufhidden=delete

augroup END

if has('gui_running')
  set guifont=Consolas:h10
  " Remove the menubar and toolbar.
  set guioptions-=m
  set guioptions-=T
  " Remove scrollbars.
  set guioptions-=r
  set guioptions-=R
  set guioptions-=l
  set guioptions-=L
  " Set default GUI width and height.
  set lines=36
  set columns=122
endif

set laststatus=2            " Always show the status bar

set statusline=%<%f\        " file name
set statusline+=(%{&ft})\   " file type

" display a warning if the file format isn't Unix.
set statusline+=%#warningmsg#
set statusline+=%{&ff!='unix'?'['.&ff.']':''}
set statusline+=%*

" display a warning if the file encoding isn't UTF-8.
set statusline+=%#warningmsg#
set statusline+=%{(&fenc!='utf-8'&&&fenc!='')?'['.&fenc.']':''}
set statusline+=%*

set statusline+=%h          " help file flag
set statusline+=%r          " read-only flag
set statusline+=%m          " modified flag

set statusline+=%{fugitive#statusline()}

set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

set statusline+=%=          " left/right separator
set statusline+=%c,         " cursor column
set statusline+=%l/%L       " cursor line/total lines
set statusline+=\ %P        " percent through file
