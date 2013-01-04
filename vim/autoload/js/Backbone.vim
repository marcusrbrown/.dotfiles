" vim: set fdm=marker:
" Vim completion for Backbone.js

let s:save_cpo = &cpo
set cpo&vim

" Backbone {{{1
let s:Backbone = {}

let s:Backbone.Events = {
  \ }

function! js#Backbone#Extend (names)
  if !exists('b:GlobalObject')
    return
  endif

  call extend(b:GlobalObject, s:Backbone)
endfunction


let &cpo = s:save_cpo
unlet s:save_cpo

