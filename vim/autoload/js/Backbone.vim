" vim: set fdm=marker:
" Vim completion for Backbone.js

let s:save_cpo = &cpo
set cpo&vim

" Backbone {{{1
let s:backbone = {}
let s:backbone.Backbone = {
  \   'kind': 'v', 'type': 'Object', 'props': {
  \     'VERSION': {'kind': 'v', 'menu': '[Backbone]', 'type': 'String'},
  \     '$': {'kind': 'f', 'menu': '[Backbone]'},
  \     'noConflict': {'kind': 'f', 'menu': '[Backbone]', 'type': 'Backbone'},
  \     'emulateHTTP': {'kind': 'v', 'menu': '[Backbone]', 'type': 'Boolean'},
  \     'emulateJSON': {'kind': 'v', 'menu': '[Backbone]', 'type': 'Boolean'},
  \   }
  \ }

" Make namespacing more convenient.
let s:Backbone = s:backbone.Backbone

" Backbone.Events {{{2
let s:Backbone.Events = {
  \   'kind': 'v', 'type': 'Object', 'props': {
  \     'on': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'once': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'off': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'trigger': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'listenTo': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'stopListening': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'bind': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \     'unbind': {'kind': 'f', 'menu': '[Event]', 'type': 'Events'},
  \   }
  \ }

call extend(s:Backbone.props, s:Backbone.Events.props)
" 2}}}

" Backbone.Model {{{2
let s:Backbone.Model = {
  \   'kind': 'f', 'type': 'Object', 'props': {
  \     'prototype': {
  \       'kind': 'v', 'menu': '[Model]', 'type': 'Object', 'props': {
  \       }
  \     }
  \   }
  \ }

call extend(s:Backbone.Model.props.prototype.props, s:Backbone.Events.props)
" 2}}}
" 1}}}

function! js#Backbone#Extend (names)
  if !exists('b:GlobalObject')
    return
  endif

  call extend(b:GlobalObject, s:backbone)
endfunction


let &cpo = s:save_cpo
unlet s:save_cpo

