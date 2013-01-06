" vim: set fdm=marker:
" Vim completion for Backbone.js

let s:save_cpo = &cpo
set cpo&vim

" Backbone module (See: http://backbonejs.org/docs/backbone.html) {{{1
let s:backbone = {}

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
  \   'kind': 'v', 'type': 'Object',
  \   'props': {
  \     'VERSION':     {'kind': 'v', 'menu': '[Backbone]', 'type': 'String'},
  \     '$':           {'kind': 'f', 'menu': '[Backbone]'},
  \     'noConflict':  {'kind': 'f', 'menu': '[Backbone]', 'type': 'Backbone'},
  \     'emulateHTTP': {'kind': 'v', 'menu': '[Backbone]', 'type': 'Boolean'},
  \     'emulateJSON': {'kind': 'v', 'menu': '[Backbone]', 'type': 'Boolean'},
  \   }
  \ }

" Make namespacing more convenient.
let s:Backbone = s:backbone.Backbone
" 2}}}

" Backbone.Events {{{2
let s:Events = {
  \   'kind': 'v', 'type': 'Object', 'menu': '[Backbone]',
  \   'props': {
  \     'on':            {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'once':          {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'off':           {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'trigger':       {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'listenTo':      {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \     'stopListening': {'kind': 'f', 'menu': '[Backbone.Events]', 'type': s:GetFunctionThis},
  \   },
  \ }

let s:Events.props.bind = s:Events.props.on
let s:Events.props.unbind = s:Events.props.off

let s:Backbone.props.Events = s:Events
call extend(s:Backbone.props, s:Backbone.props.Events.props)
" 2}}}

" Backbone.Model {{{2

" Construct a Model instance. Mimic the Backbone.js Model constructor as much
" as possible. Note that _CreateModel() is a dictionary function which
" provides access to the self variable, so that we can create instances of
" classes that were extended from Model.
function s:_CreateModel(arguments, parent) dict
  " TODO: Collection, defaults, and all that...
  let attrs = get(get(a:arguments, 0, {}), 'props', {})
  let options = get(get(a:arguments, 1, {}), 'props', {})
  let instance = {'props': {'prototype': deepcopy(self.props.prototype)}}
  let protoProps = {
    \   'cid':        {'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'Number'},
    \   'attributes': {
    \     'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'Object',
    \     'props': {}
    \   }
    \ }

  " TODO: Get defaults.
  " Extend the attributes object with the given attributes, simulating
  " Model.set().
  call extend(protoProps.attributes.props, attrs)
  call extend(instance.props.prototype.props, protoProps)
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

  return s:GetFunctionThis(a:arguments, a:parent)
endfunction

let s:GetModelClass = function(s:SID().'_GetModelClass')

function s:_GetModelType(parent)
  return s:Model
endfunction

let s:GetModelType = function(s:SID().'_GetModelType')

let s:Model = {
  \   'kind': 'f', 'newType': s:CreateModel, 'menu': '[Backbone]',
  \   'props': {
  \     'prototype': {
  \       'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'Object', 'class': s:GetModelClass,
  \       'props': {
  \         'changed':            {'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'idAttribute':        {'kind': 'v', 'menu': '[Backbone.Model]', 'type': 'String'},
  \         'initialize':         {'kind': 'f', 'menu': '[Backbone.Model]', 'type': ''},
  \         'toJSON':             {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'sync':               {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'get':                {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'escape':             {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'String'},
  \         'has':                {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Boolean'},
  \         'set':                {'kind': 'f', 'menu': '[Backbone.Model]', 'type': s:GetFunctionThis},
  \         'unset':              {'kind': 'f', 'menu': '[Backbone.Model]', 'type': s:GetFunctionThis},
  \         'clear':              {'kind': 'f', 'menu': '[Backbone.Model]', 'type': s:GetFunctionThis},
  \         'fetch':              {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'save':               {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'destroy':            {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'url':                {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'String'},
  \         'parse':              {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'clone':              {'kind': 'f', 'menu': '[Backbone.Model]', 'type': s:GetFunctionThis},
  \         'isNew':              {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Boolean'},
  \         'change':             {'kind': 'f', 'menu': '[Backbone.Model]', 'type': s:GetFunctionThis},
  \         'hasChanged':         {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Boolean'},
  \         'changedAttributes':  {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'previous':           {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \         'previousAttributes': {'kind': 'f', 'menu': '[Backbone.Model]', 'type': 'Object'},
  \       }
  \     }
  \   }
  \ }

let s:Backbone.props.Model = s:Model
call extend(s:Model.props.prototype.props, s:Events.props)
" 2}}}

" Backbone.Collection {{{2

" Construct a Collection instance. Simulates the Backbone.js Collection
" constructor function. Supports Collection classes created with
" Collection.extend() through the self dictionary variable.
function s:_CreateCollection(arguments, parent) dict
  let models = get(get(a:arguments, 0, {}), 'props', {})
  let options = get(get(a:arguments, 1, {}), 'props', {})
  let instance = {'props': {'prototype': deepcopy(self.props.prototype)}}
  let protoProps = {
    \   'length': {'kind': 'v', 'menu': '[Backbone.Collection]', 'type': 'Number'},
    \   'models': {
    \     'kind': 'v', 'menu': '[Backbone.Collection]', 'type': 'Array', 'class': 'Array',
    \     'props': {}
    \   }
    \ }
  let model = get(options, 'model', {})
  let comparator = get(options, 'comparator', {})

  if !empty(model)
    protoProps.model = model
  endif

  if !empty(comparator)
    protoProps.comparator = comparator
  endif

  " TODO: This isn't a good approximation of Collection.reset(), do we need
  " anything more? Do we care to coerce the models argument to an array?
  call extend(protoProps.models.props, models)

  call extend(instance.props.prototype.props, protoProps)
  "echo 'CreateCollection - Instance:'
  "call DictView_Print(instance)
  return instance
endfunction

let s:CreateCollection = function(s:SID().'_CreateCollection')

function s:_GetCollectionType(parent)
  return s:Collection
endfunction

let s:GetCollectionType = function(s:SID().'_GetCollectionType')

let s:Collection = {
  \   'kind': 'f', 'newType': s:CreateCollection, 'menu': '[Backbone]',
  \   'props': {
  \     'prototype': {
  \       'kind': 'v', 'menu': '[Backbone.Collection]', 'type': 'Object', 'class': s:GetCollectionType,
  \       'props': {
  \         'model': {'kind': 'v', 'menu': '[Backbone.Collection]', 'type': s:GetModelType},
  \       }
  \     }
  \   }
  \ }

call extend(s:Collection.props.prototype.props, s:Events.props)
let s:Backbone.props.Collection = s:Collection
" 2}}}

" extend() helper function {{{2
function s:_ExtendType(arguments, parent)
  " Argument 0 has the optional prototype properties.
  " Argument 1 has the optional class properties.
  let protoProps = get(get(a:arguments, 0, {}), 'props', {})
  let staticProps = get(get(a:arguments, 1, {}), 'props', {})
  " Get the type to extend.
  let parent = s:GetFunctionThis(a:arguments, a:parent)

  " TODO: Bother with the constructor?
  " Create the child as a constructor function that calls through the parent's
  " 'newType' property. The function defined for 'newType' will handle the
  " rest. Default to the 'type' property if 'newType' isn't available, and to
  " the global 'Object' type as a last resort.
  let NewType = get(parent, 'newType', get(parent, 'type', 'Object'))
  let child = {'kind': 'f', 'newType': NewType, 'props': {}}

  call extend(child.props, deepcopy(parent.props))
  call extend(child.props, staticProps)

  if !has_key(child.props, 'prototype')
    child.props.prototype = {}
  endif

  call extend(child.props.prototype.props, protoProps)
  return child
endfunction

let s:ExtendType = function(s:SID().'_ExtendType')
let s:extend = {'kind': 'f', 'type': s:ExtendType}

" Add extend() to all Backbone classes.
let s:Model.props.extend = s:extend
let s:Collection.props.extend = s:extend
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

