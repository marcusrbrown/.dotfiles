" vim: set fdm=marker:
" Vim completion for Backbone.js

let s:save_cpo = &cpo
set cpo&vim

" Backbone module (See: http://backbonejs.org/docs/backbone.html) {{{1
" The 'this' dictionary is used to define dictionaries and functions only used
" in this script. All of the Backbone classes are namespaced; so we need to
" return 'type' functions that generate class type info.
let s:this = {}

" Access 'backbone' from 'this'.
let s:this.backbone = {}
let s:backbone = s:this.backbone

" Borrowed from jscript.vim.
function s:SID()
  if exists('s:SID_PREFIX')
    return s:SID_PREFIX
  else
    let s:SID_PREFIX = matchstr(expand('<sfile>'), '\zs<SNR>\d\+_\zeSID$')
    return s:SID_PREFIX
  endif
endfunction

" Return the passed object (in parent). Used as the 'type' value for instance
" methods that return the 'this' reference.
function s:GetThis(arguments, parent)
  return !empty(a:parent) ? a:parent : {}
endfunction

let s:this.GetThis = function(s:SID().'GetThis')


" Backbone {{{2
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
" 2}}}

" Backbone.Events {{{2


let s:this.Events = {
  \   'kind': 'v', 'type': 'Object', 'menu': '[Backbone]',
  \   'props': {
  \     'on': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:this.GetThis},
  \     'once': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:this.GetThis},
  \     'off': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:this.GetThis},
  \     'trigger': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:this.GetThis},
  \     'listenTo': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:this.GetThis},
  \     'stopListening': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:this.GetThis},
  \   },
  \ }

let s:this.Events.props.bind = s:this.Events.props.on
let s:this.Events.props.unbind = s:this.Events.props.off

let s:Backbone.props.Events = s:this.Events
call extend(s:Backbone.props, s:Backbone.props.Events.props)
" 2}}}

" Backbone.Model {{{2
let s:Backbone.props.Model = {
  \   'kind': 'f', 'type': 'Model', 'props': {
  \     'prototype': {
  \       'kind': 'v', 'menu': '[Model]', 'type': 'Object', 'class': 'Model', 'props': {
  \         'changed': {'kind': 'v', 'menu': '[Model]', 'type': 'Object'},
  \         'idAttribute': {'kind': 'v', 'menu': '[Model]', 'type': 'String'},
  \         'initialize': {'kind': 'f', 'menu': '[Model]', 'type': ''},
  \       }
  \     }
  \   }
  \ }

call extend(s:Backbone.props.Model.props.prototype.props, s:Backbone.props.Events.props)
" 2}}}
" 1}}}


function! js#backbone#Extend (names)
  if !exists('b:GlobalObject')
    return
  endif

  call extend(b:GlobalObject, s:backbone)

  "runtime plugin/dictview.vim
  call DictView_Print(s:backbone)
endfunction


let &cpo = s:save_cpo
unlet s:save_cpo

