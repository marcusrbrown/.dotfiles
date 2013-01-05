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
" NOTE: This can't be used in constructor functions, as they aren't passed a
" parent parameter.
function s:_GetFunctionThis(arguments, parent)
  return !empty(a:parent) ? a:parent : {}
endfunction

let s:GetFunctionThis = function(s:SID().'_GetFunctionThis')


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
  \     'on': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'once': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'off': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'trigger': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'listenTo': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'stopListening': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \   },
  \ }

let s:this.Events.props.bind = s:this.Events.props.on
let s:this.Events.props.unbind = s:this.Events.props.off

let s:Backbone.props.Events = s:this.Events
call extend(s:Backbone.props, s:Backbone.props.Events.props)
" 2}}}

" Backbone.Model {{{2

" Construct a Model instance. Mimic the Backbone.js Model constructor as much
" as possible.
function s:_CreateModel(arguments, parent)
  " TODO: Collection, defaults, and all that...
  let attrs = get(get(a:arguments, 0, {}), 'props', {})
  let options = get(a:arguments, 1, {})
  let instance = {'props': {'prototype': deepcopy(s:Model.props.prototype)}}

  call extend(instance.props.prototype.props, attrs)
  "echo 'CreateModel - Instance:'
  "call DictView_Print(instance)
  return instance
endfunction

let s:CreateModel = function(s:SID().'_CreateModel')

" Return the Model's class.
function s:_GetModelClass(arguments, parent)
  echo "GetModelClass - Arguments:"
  call DictView_Print(a:arguments)
  echo "GetModelClass - Parent:"
  call DictView_Print(a:parent)

  return s:GetThis(a:arguments, a:parent)
endfunction

let s:GetModelClass = function(s:SID().'_GetModelClass')

let s:Model = {
  \   'kind': 'f', 'type': '', 'newType': s:CreateModel, 'menu': '[Backbone]',
  \   'props': {
  \     'prototype': {
  \       'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'Object', 'class': s:GetModelClass,
  \       'props': {
  \         'changed': {'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'idAttribute': {'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'String'},
  \         'initialize': {'kind': 'f', 'menu': '[Backbone.Model]', 'type': ''},
  \       }
  \     }
  \   }
  \ }

let s:Backbone.props.Model = s:Model
call extend(s:Model.props.prototype.props, s:this.Events.props)
" 2}}}
" 1}}}


function! js#backbone#Extend (names)
  if !exists('b:GlobalObject')
    return
  endif

  call extend(b:GlobalObject, s:backbone)

  "call DictView_Print(s:backbone)
endfunction


let &cpo = s:save_cpo
unlet s:save_cpo

