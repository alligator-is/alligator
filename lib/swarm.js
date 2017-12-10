var Peer = require('icebreaker-peer')
var util = Peer.util
var _ = require('icebreaker')
var ms = require('ms')
var Notify = require('pull-notify')
var MRPC = require('muxrpc')
var merge = require('map-merge')
var flatten = require("flat").flatten
var unflatten = require("flat").unflatten
var pick = require('lodash.pick')
var URL = require('url')
var clone = require('lodash.clonedeep')
var paramap = require('pull-paramap')
var handshake = require('./handshake')

function prefix(key, val) {
  if (!key) return val
  var obj = {}
  obj[key] = val
  return obj
}

function para(events) {
  return paramap(function handle(e, cb) {
    if (events[e.type] != null && typeof events[e.type] === 'function')
      return events[e.type].call(this, e, function (d) {
        cb(null, d)
      })
    cb(null, e)
  })
}

var Swarm = module.exports = function Swarm(api) {
  var params = clone(api.config.info)

  if (!params) params = {}
  params.encoding = params.encoding || 'base58'
  params.authenticate = params.authenticate || function authenticate(id, cb) {
    cb(null, true)
  }

  params.keys = clone(params.keys)
  var peer = Peer(params)
  var peers = {}
  var seen = []
  var _manifest = {}
  var manifest = {}
  var notify = Notify()
  var _ready = false
  var queue = []
  var gid = 0
  var shutdown = false
  api.config.swarm = api.config.swarm || {}
  var _api = {}
  var _perms = {}

  var timeout = require('./timeout')

  function source() {
    if (_ready === false) {

      _ready = notify.listen()

      _(_(peer, peer.asyncMap({
        connection: function (e, cb) {
          api.logger.info('connection from', e.peerID, 'protocol', e.protocol, 'on', api.id)

          _(e, handshake(_manifest || {}, function (err, rest, remote) {

            if (err) {
              if (e.rpcCallback != null) {
                var c = e.rpcCallback
                delete e.rpcCallback
                c(err)
              }
              api.logger.error('handshake error', err)
              return cb(null)
            }


            var close = false

            var found = false
            for (var i in peers) {
              var p = peers[i]
              if (p.peerID === e.peerID) {
                found = true
                break
              }
            }

            if (e.peerID && found === true) {
              err = 'closing connection to peer ' + e.peerID + ' is already connected on ' + api.id
              close = true
            }

            if (e.peerID == null) {
              err = 'closing the connection peerID is undefined or null ' + api.id
              close = true
            }

            if (shutdown === true) {
              err = 'peer cannot accept new connections, because it is shutting down'
              close = true
            }

            e.id = ++gid
            peers[e.id] = e
            e.protocols = []
            Object.keys(remote).forEach(function (i) { e.protocols.push(i) })
            e.manifest = remote
            
            var perms = _perms.anonymous
            if (e.protocol.indexOf("+unix") !== -1) perms = null
            
            var muxrpc = MRPC(remote, _manifest)(_api, perms, e.id)

            var t

            _(rest, t = timeout(muxrpc.createStream(), api.config.swarm.timeout = api.config.swarm.timeout || ms('40s'), function () {
              if (this.end) this.end()
              close = true
            }.bind(e)), rest)
            e.peer = muxrpc
            e.end = muxrpc.close.bind(muxrpc, err || true, function (_err) {
              if (_err) api.logger.error(_err)
              else if (err != null) api.logger.warn(err)
              t.end()
            })
            if (close === true) {
              e.end();
              return cb(e)
            }

            delete e.peer.close
            delete e.peer.createStream

            cb(e)
          }, e.address == null), e)
        },
        disconnection: function (e, cb) {
          if (e.id != null && peers[e.id] != null) delete peers[e.id]
          cb(e)
        }
      })), _.filter(function (e) {
        return e != null
      }), peer.asyncMap({
        connection: function (e, cb) {
          if (e.rpcCallback != null) {
            var c = e.rpcCallback
            delete e.rpcCallback
            c(null, e)
            return cb(e)
          }
          cb(e)
        }
      }), _.drain(notify, notify.abort))

    }
    return _ready.apply(null, [].slice.call(arguments))
  }

  source.peerID = util.encode(params.keys.publicKey, params.encoding)

  source.map = peer.map
  source.asyncMap = peer.asyncMap
  source.paraMap = para
  source.events = notify.listen
  source.encoding = params.encoding
  source.protoNames = peer.protoNames
  source.push = peer.push
  source.path = 'swarm'

  source.connect = function (addr, params, cb) {

    if (shutdown === true) {
      if (cb) cb(new Error('shutting down'))
      return
    }
    if (_.isFunction(params)) {
      cb = params
      params = null
    }

    params = params || {}
    var id = URL.parse(addr).auth

    var found = false

    for (var i in peers) {
      var p = peers[i]
      if (p.peerID === id) {
        if (cb) return cb(null, p)
        found = true
        if (!cb) break
      }
    }


    if (found !== true && seen.indexOf(id) === -1) {
      seen.push(id)
      return peer.connect(addr, params, function (err, connection) {

        if (seen.indexOf(id) !== -1) seen.splice(seen.indexOf(id), 1)
        if (cb) {

          if (err != null) return cb(err)

          connection.rpcCallback = cb
        }
      })
    }

    return cb(new Error('peer already connecting'))
  }

  source.end = function () {
    if (shutdown === true) return
    shutdown = true
    peer.end.apply(peer, [].slice.call(arguments))
  }

  source.listen = peer.listen
  source.on = peer.on
  source.connections = peers
  source.combine = peer.combine

  source.addProtocol = function (protocol) {
    if (protocol.path == null && protocol.manifest == null) return
    protocol = clone(protocol)
    var a = merge(api, unflatten(prefix(protocol.path, protocol), { safe: true }))
    for (var k in a) { api[k] = a[k] }
    _manifest = merge(_manifest, unflatten(prefix(protocol.path, protocol.manifest), { safe: true }))
    if (_.isPlainObject(protocol.permissions)) {
      for (var pk in protocol.permissions) {
        var allow = []
        var deny = []
        if (!_perms[pk]) _perms[pk] = {}

        var perms = flatten(prefix(protocol.path, protocol.permissions[pk]), { safe: true })
        for (var i in perms) {
          if (perms[i]) allow.push(i)
          else deny.push(i)
        }

        if (deny.length > 0) {
          if (!_perms[pk]["deny"]) _perms[pk]["deny"] = []
          _perms[pk]["deny"] = merge(_perms[pk]["deny"], deny)
        }

        if (allow.length > 0) {
          if (!_perms[pk]["allow"]) _perms[pk]["allow"] = []
          _perms[pk]["allow"] = merge(_perms[pk]["allow"], allow)
        }
      }
    }

    var paths = Object.keys(flatten(prefix(protocol.path, protocol.manifest), { safe: true }))
    var filtered = unflatten(pick(flatten(prefix(protocol.path, protocol), { safe: true }), paths), { safe: true })
    _api = merge(_api, filtered)

  }

  source.path = 'swarm'
  source.manifest = manifest
  source.addProtocol(source)
  return source
}

Swarm.util = Peer.util