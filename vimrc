" ~/.vimrc
" vim: set ft=vim et tw=120 ts=2 sw=2 sts=2:

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
set history=2000        " keep 2000 lines of command line history
set ruler               " show the cursor position all the time
set showcmd             " Show (partial) command in status line.
set showmatch           " Show matching brackets...
set matchtime=2         " ... for .2 seconds.
set ignorecase          " Do case insensitive matching...
set smartcase           " ...if there are no capital letters in the search expression
set incsearch           " Incremental search
set noautowrite         " Don't automatically save before commands like :next and :make
set autoread            " Reread files that have changed
set number              " Show line numbers
set numberwidth=1       " Use only 1 column for line numbers when possible
set hidden              " Hide abandoned buffers instead of removing them

" Disable Vim modelines for securemodelines.vim.
set nomodeline

" Look for Vim modelines at the top or bottom of files, and look at least 6
" lines in (past a copyright header, etc.).
let g:secure_modelines_verbose=0
let g:secure_modelines_modelines=6


" Backups
" Disable all backups and swapfiles.
set nobackup
set nowritebackup
set noswapfile
set backupcopy=yes                  " Make sure attributes, etc. are preserved.
set backupdir=$HOME/.vim/backup
set directory=$HOME/.vim/swap,~/tmp,.


" Tabs and whitespace
set tabstop=2
set shiftwidth=2
set softtabstop=2
" Turn off autoident, smart indent, and C indent (enabled by file type)
set noautoindent
set nosmartindent
set nocindent
set smarttab
set expandtab
set nowrap
set list
set listchars=tab:→\ ,trail:·,nbsp:·


" Setup folding. Disable folding initially.
set foldmethod=indent
set nofoldenable
set foldcolumn=0
set foldlevelstart=99
set foldnestmax=3
set foldtext=MyFoldText()

" Set in foldtext, displays the folded text.
function! MyFoldText()
  let nlines = v:foldend - v:foldstart + 1
  return v:folddashes . getline(v:foldstart)[:winwidth(0)-10]. ' ▼ ' . nlines . ' lines '
endfunction

" Enable syntax folding for vim files
let g:vimsyn_folding = 'afmpPrt'


" Wildmode
" First tab completes to the longest common string while displaying the wildmenu.
" Second tab completes the next full match, cycles through the wildmenu, and wraps to the original string.
set wildmode=longest:full,full
set wildmenu
set wildignore=*.o,*.obj,*~,tags,*.pyo,*.pyc,*.swp

set background=dark
colorscheme solarized


" Insert completion

set completeopt=menuone,longest,preview
set pumheight=6     " 6 lines in the popup menu

" Suffixes that get lower priority when doing tab completion for filenames.
" These are files we are not likely to want to edit or read.
set suffixes=.bak,~,.swp,.o,.info,.aux,.log,.dvi,.bbl,.blg,.brf,.cb,.ind,.idx,.ilg,.inx,.out,.toc

" Search for tags file in parent directories
set tags=tags;/


" TODO: Make this a bit more robust / check terminal types, etc.
set t_Co=256

syntax on

filetype plugin indent on

" EOL formats in preferred order
set fileformats=unix,dos,mac

augroup filebufcmds
  autocmd!

  autocmd FileType text setlocal expandtab shiftwidth=4 tabstop=4 textwidth=78 smarttab
  autocmd FileType c,cpp setlocal formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://
  autocmd FileType d setlocal formatoptions=croql cindent comments=sr:/*,mb:*,el:*/,:// sw=4 ts=4 smarttab
  autocmd FileType cs setlocal formatoptions=croql cindent sw=4 ts=4 smarttab comments=sr:/*,mb:*,el:*/,://

  " PEP8 requires a max. line length of 79 characters, but we use a max. of 100.
  autocmd FileType python setlocal tabstop=4 shiftwidth=4 softtabstop=4 expandtab smarttab textwidth=100
  autocmd FileType python setlocal keywordprg=pydoc
  autocmd FileType python setlocal omnifunc=pythoncomplete#Complete
  " auto indent after "def foo():<CR>"
  autocmd BufRead python set nosmartindent
  " automatically strip trailing whitespace from Python scripts
  autocmd BufWritePre python normal m`:%s/\s\+$//e ``
  let python_highlight_all = 1            " Enable full syntax highlighting.

  autocmd FileType lua setlocal tabstop=4 shiftwidth=4 smarttab

  autocmd FileType sh setlocal tabstop=2 shiftwidth=2 expandtab smarttab nosmartindent autoindent
  autocmd FileType sh setlocal foldmethod=syntax
  let g:is_bash = 1                   " Assume the shell is bash
  let g:sh_fold_enabled = 7           " Enable function, heredoc, and if/do/for syntax folding

  autocmd FileType javascript setlocal tabstop=4 shiftwidth=4 softtabstop=4 expandtab
  " Use jscomplete-vim for JavaScript omnicompletion.
  autocmd FileType javascript setlocal omnifunc=jscomplete#CompleteJS
  " Use the suggested vim-javascript configuration for inline Javascript.
  let g:html_indent_inctags = "html,body,head,tbody"
  let g:html_indent_script1 = "inc"
  let g:html_indent_style1 = "inc"

  " vim-javascript thinks JSON is Javascript, but it ain't.
  autocmd BufRead,BufNewFile *.json set filetype=json

  autocmd FileType json setlocal autoindent tabstop=8 shiftwidth=2 softtabstop=2 textwidth=78 expandtab
  autocmd FileType json setlocal formatoptions=tcq2l foldmethod=syntax
  " Don't hide quotation marks (vim-json).
  autocmd FileType json setlocal conceallevel=0

  autocmd FileType vim setlocal autoindent expandtab smarttab tabstop=2 shiftwidth=2 softtabstop=2 keywordprg=:help
  autocmd FileType vim setlocal foldmethod=syntax
  " Reset the formatoptions set by the vim filetype plugin:
  " Don't insert the comment leader after hitting Enter
  " Don't insert the comment leader after hitting o or O
  autocmd FileType vim setlocal formatoptions-=ro

  autocmd FileType help nmap <buffer> <Return> <C-]>
  autocmd FileType help nmap <buffer> <Backspace> <C-T>
  autocmd FileType help setlocal statusline=%t%h%=%p%%

  autocmd FileType dosbatch setlocal fileformat=dos expandtab shiftwidth=4 softtabstop=4

  autocmd FileType git,gitcommit setlocal foldmethod=syntax foldlevel=1

  autocmd FileType java setlocal shiftwidth=4 tabstop=4 softtabstop=4 expandtab

  autocmd FileType make setlocal tabstop=8 shiftwidth=8 softtabstop=8 noexpandtab

  " Defaults for omnifunc and completefunc
  autocmd FileType * if exists("+omnifunc") && &omnifunc == "" | setlocal omnifunc=syntaxcomplete#Complete | endif
  autocmd FileType * if exists("+completefunc") && &completefunc == "" | setlocal completefunc=syntaxcomplete#Complete | endif

  " Attempt filetype detection after writing.
  autocmd BufWritePost * if empty(&ft) | filetype detect | endif

  " Tag a git tree after writing a buffer.
  autocmd BufWritePost * call TagGitTree()

augroup END

augroup vimrcEx
  autocmd!

  " Save all writeable buffers when losing focus
  autocmd FocusLost * silent! wall

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

  " Current directory follows the file being edited for local files
  autocmd BufEnter *
    \ if bufname("") !~ '^[[:alnum:]]*://' |
    \   silent! lcd %:p:h |
    \ endif

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

augroup QuickFix
  autocmd!

  " Open the quickfix window if it has entries
  autocmd QuickFixCmdPost * botright cwindow 5

  " Close the quickfix window with q.
  autocmd BufWinEnter *
    \ if &buftype == 'quickfix' | noremap <buffer><silent> q :cclose<CR> | endif

  autocmd QuickFixCmdPre *
    \ let g:old_titlestring=&titlestring |
    \ let &titlestring="[ " . expand("<amatch>") . " ] " . &titlestring |
    \ redraw
  autocmd QuickFixCmdPost *
    \ let &titlestring=g:old_titlestring

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
  " Enable visual and modeless autoselect (to clipboard and the "* register).
  set guioptions+=aA

  " TODO: Create highlights for the n-v-c modes, and for the insert modes.
  set guicursor=n-v-c:hor15-Cursor
  set guicursor+=i-ci:hor15-Cursor
  set guicursor+=r-cr:ver25-Cursor
  set guicursor+=sm:hor15

  " These values configure the RestoreScreen script.
  " Don't restore the screen position.
  let g:screen_size_restore_pos = 0
  " Restore the screen size.
  let g:screen_size_restore_size = 1
  " Don't restore screen size and position for every separate VIM instance.
  let g:screen_size_by_vim_instance = 0
  " Always read/write from .vimsize, not _vimsize on Windows.
  let g:screen_size_use_dot_vimsize = 1
endif


" Set the title under a xterm
if &term =~ "xterm" && has('title')
  set title
endif

" Fancy window titles where possible
if has('title') && (has('gui_running') || &title)
  set titlestring=
  set titlestring+=%f
  set titlestring+=%h%m%r%w

  if has('win32')
    let win_home = escape(substitute($HOME,'/','\\','g'),'\\')
    set titlestring+=\ -\ %{substitute(getcwd(),\ win_home,\ '~',\ '')}
  else
    set titlestring+=\ -\ %{substitute(getcwd(),\ $HOME,\ '~',\ '')}
  endif
endif


set shortmess=atI           " All abbreviations; truncate file message; no intro
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

set statusline+=%{virtualenv#statusline()!=''?'[workon\ '.virtualenv#statusline().']':''}
set statusline+=%{fugitive#statusline()}

"display a warning if &et is wrong, or we have mixed-indenting
set statusline+=%#error#
set statusline+=%{StatuslineTabWarning()}
set statusline+=%*

set statusline+=%{StatuslineTrailingSpaceWarning()}

set statusline+=%{StatuslineLongLineWarning()}

set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

"display a warning if &paste is set
set statusline+=%#error#
set statusline+=%{&paste?'[paste]':''}
set statusline+=%*

set statusline+=%=          " left/right separator
set statusline+=%{StatuslineCurrentHighlight()}\ \ " current highlight
set statusline+=%c,         " cursor column
set statusline+=%l/%L       " cursor line/total lines
set statusline+=\ %P        " percent through file

augroup StatusLine
  autocmd!

  " recalculate the tab warning flag when idle and after writing
  autocmd CursorHold,BufWritePost * unlet! b:statusline_tab_warning

  " recalculate the trailing whitespace warning when idle, and after saving
  autocmd CursorHold,BufWritePost * unlet! b:statusline_trailing_space_warning

  " recalculate the long line warning when idle and after saving
  autocmd CursorHold,BufWritePost * unlet! b:statusline_long_line_warning

augroup END

" return '[&et]' if &et is set wrong
" return '[mixed-indenting]' if spaces and tabs are used to indent
" return an empty string if everything is fine
function! StatuslineTabWarning()
    if !exists("b:statusline_tab_warning")
        let tabs = search('^\t', 'nw') != 0
        let spaces = search('^ ', 'nw') != 0

        if tabs && spaces
            let b:statusline_tab_warning =  '[mixed-indenting]'
        elseif (spaces && !&et) || (tabs && &et)
            let b:statusline_tab_warning = '[&et]'
        else
            let b:statusline_tab_warning = ''
        endif
    endif
    return b:statusline_tab_warning
endfunction

" return '[\s]' if trailing white space is detected
" return '' otherwise
function! StatuslineTrailingSpaceWarning()
    if !exists("b:statusline_trailing_space_warning")
        if search('\s\+$', 'nw') != 0
            let b:statusline_trailing_space_warning = '[\s]'
        else
            let b:statusline_trailing_space_warning = ''
        endif
    endif
    return b:statusline_trailing_space_warning
endfunction

" return a warning for "long lines" where "long" is either &textwidth or 80 (if
" no &textwidth is set)
" return '' if no long lines
" return '[#x,my,$z] if long lines are found, were x is the number of long
" lines, y is the median length of the long lines and z is the length of the
" longest line
function! StatuslineLongLineWarning()
    if !exists("b:statusline_long_line_warning")
        let long_line_lens = s:LongLines()

        if len(long_line_lens) > 0
            let b:statusline_long_line_warning = "[" .
                        \ '#' . len(long_line_lens) . "," .
                        \ 'm' . s:Median(long_line_lens) . "," .
                        \ '$' . max(long_line_lens) . "]"
        else
            let b:statusline_long_line_warning = ""
        endif
    endif
    return b:statusline_long_line_warning
endfunction

" return a list containing the lengths of the long lines in this buffer
function! s:LongLines()
    let threshold = (&tw ? &tw : 80)
    let spaces = repeat(" ", &ts)

    let long_line_lens = []

    let i = 1
    while i <= line("$")
        let len = strlen(substitute(getline(i), '\t', spaces, 'g'))
        if len > threshold
            call add(long_line_lens, len)
        endif
        let i += 1
    endwhile

    return long_line_lens
endfunction

" find the median of the given array of numbers
function! s:Median(nums)
    let nums = sort(a:nums)
    let l = len(nums)

    if l % 2 == 1
        let i = (l-1) / 2
        return nums[i]
    else
        return (nums[l/2] + nums[(l/2)-1]) / 2
    endif
endfunction

" return the syntax highlight group under the cursor ''
function! StatuslineCurrentHighlight()
    let name = synIDattr(synID(line('.'),col('.'),1),'name')
    if name == ''
        return ''
    else
        return '[' . name . ']'
    endif
endfunction

" Run the ctags git hook script over the entire git tree if available.
function! TagGitTree()
  if exists('b:git_dir') && filereadable(b:git_dir.'/hooks/ctags')
    call system('sh "'.b:git_dir.'/hooks/ctags" append')
  endif
endfunction


" Key mappings

" Remap the leader key from "\" to ","
let mapleader = ","
let g:mapleader = ","

" Edit .vimrc with <leader>v, reload it with <leader>V
map <Leader>v :split $MYVIMRC<CR><C-W>_
map <silent> <Leader>V :source $MYVIMRC<CR>:filetype detect<CR>:exe ":echo '.vimrc reloaded'"<CR>

" Save with <Leader>w and Ctrl+S
map  <Leader>w :w<CR>
nmap <C-S> :w<CR>
vmap <C-S> <ESC><C-S>
imap <C-S> <ESC><C-S>

" Make F1 useful and less error-prone
map  <F1> <Esc>
map! <F1> <Esc>

" Map jj to Escape in insert mode
inoremap jj <ESC>

" Shift-Insert pastes, like the terminal
noremap  <S-Insert> <MiddleMouse>
noremap! <S-Insert> <MiddleMouse>

" Easier split navigation
map  <C-J> <C-W>j
map  <C-K> <C-W>k
map  <C-L> <C-W>l
map  <C-H> <C-W>h
" Also map Ctrl+W in insert mode
imap <C-W> <C-O><C-W>

" Shorten omnicompletion sequence to Ctrl+Space
if has('gui_running')
  inoremap <C-Space> <C-X><C-O>
else
  inoremap <Nul> <C-X><C-O>
endif

" Toggle current fold
nnoremap <Space> za

" Shift-Tab inserts a hard tab
imap <silent> <S-Tab> <C-V><Tab>

" Make Y consistent with C and D
nnoremap Y y$

" Instead of Ex mode, Q formats text
noremap Q gq

" Auto-close markup tags when typing </
inoremap <lt>/ </<C-X><C-O>

" mrbrown: Fix the Home/End keys in vim (from http://www.mingw.org/wiki/Configure_RXVT)
map <Esc>[7~ <Home>
map <Esc>[8~ <End>
imap <Esc>[7~ <Home>
imap <Esc>[8~ <End>

" Home toggles between the start of the line and the start of text
imap <kHome> <Home>
nmap <kHome> <Home>
inoremap <silent> <Home> <C-O>:call Home()<CR>
nnoremap <silent> <Home> :call Home()<CR>

function! Home()
  let curcol = wincol()
  normal ^
  let newcol = wincol()
  if newcol == curcol
    normal 0
  endif
endfunction

" Run flake8
autocmd FileType python map <buffer> <Leader>8 :call Flake8()<CR>

" Toggle Gundo
nnoremap <Leader>u <ESC>:GundoToggle<CR>

" NERDCommenter
" Don't use the default mappings
let NERDCreateDefaultMappings=0

" Toggle comments across a single line or multiple selected lines
map <Leader>c <plug>NERDCommenterToggle

" NERDTree
let NERDTreeIgnore = ['\.pyc$', '\.pyo$']
map <Leader>t :NERDTree<CR>

" Tagbar
let g:tagbar_compact = 1
nmap <silent> <Leader>\\ :TagbarOpenAutoClose<CR>
nmap <silent> <Leader>\| :TagbarToggle<CR>

" Override Tagbar's JavaScript support to match our ctags setup.
" We disable the JavaScript languge globally; we instead define a language called 'js'
" so we have to override the 'ctagstype' key.
" TODO: Add support for jsctags (DoctorJS) / jshint.
"let g:tagbar_type_javascript = {
      "\ 'ctagstype' : 'js',
      "\ 'kinds' : [
      "\   'v:variables:0:0',
      "\   'f:functions:0:1'
      "\ ],
      "\ 'sro' : '.',
      "\ 'kind2scope' : {
      "\   'v' : 'namespace',
      "\   'f' : 'namespace',
      "\ },
      "\ 'scope2kind' : {
      "\   'namespace' : 'v'
      "\ }
      "\ }
let g:tagbar_type_javascript = {
      \ 'ctagstype' : 'js',
      \ 'kinds' : [
      \   'v:variables:0:0',
      \   'f:functions:0:1'
      \ ],
      \ 'sro' : '.'
      \ }

" MakeGreen
" Create a bogus mapping to MakeGreen to prevent it from taking over <Leader>t.
" I don't invoke MakeGreen directly, it's here for other plugins that use it.
map <silent> <Leader>\bogusmakegreenmapping :call MakeGreen()<CR>

" TaskList
map <Leader>T <Plug>TaskList
let g:tlTokenList = ['FIXME', 'TODO', 'todo', 'XXX']
let g:tlWindowPosition = 1          " Open the TaskList window at the bottom
let g:tlRememberPosition = 1        " Reset to last remembered cursor position.

" Rope-vim
let g:ropevim_local_prefix = '<Leader>r'
let g:ropevim_global_prefix = '<Leader>p'

" Syntastic
let g:syntastic_disabled_filetypes = ['c', 'cpp']

" jscomplete-vim
let g:jscomplete_use = ['dom', 'Backbone']


" Commands

" define :HighlightLongLines command to highlight the offending parts of
" lines that are longer than the specified length (defaulting to 80)
command! -nargs=? HighlightLongLines call s:HighlightLongLines('<args>')
function! s:HighlightLongLines(width)
    let textWidth = &tw ? &tw : 80
    let targetWidth = a:width != '' ? a:width : textWidth
    if targetWidth > 0
        exec 'match Todo /\%>' . (targetWidth) . 'v/'
    else
        echomsg "Usage: HighlightLongLines [natural number]"
    endif
endfunction
