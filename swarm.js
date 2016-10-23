var Peer = require('icebreaker-peer')
var util = Peer.util
var _ = require('icebreaker')
var m = require('muxrpc/util')
var ms = require('ms')
var Notify = require('pull-notify')
var MRPC = require('muxrpc')
var URL = require('url')
var Inactive = require('pull-inactivity')
var clone = require('lodash.clonedeep')
var ping = require('pull-ping')
var goodbye = require('pull-goodbye')
var mdm = require('mdmanifest')
var doc = require('./apidocs').swarm

var Swarm = module.exports = function Swarm(api) {
  var params = clone(api.config.info);
  if (!params) params = {}
  params.encoding = params.encoding || 'base58'
  params.authenticate = params.authenticate || function authenticate(id, cb) {
    cb(null, true)
  }
  params.encoding = params.encoding || 'base58'

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

  var _api = {}
  function source() {
    if (_ready === false) {

      _ready = notify.listen()
      _(_(peer, peer.map({
        connection: function (e) {
          var close = false
          var err

          var found = false
          for (var i in peers) {
            var p = peers[i]
            if (p.peerID === e.peerID) {
              found = true
              break
            }
          }

          if (e.peerID && found === true) {
            err = 'Peer already connected'
            close = true
          }

          e.id = ++gid
          peers[e.id] = e

          var muxrpc = MRPC(_manifest, _manifest)(_api, null, e.id)
          _(e, Inactive(muxrpc.createStream(), api.config.timeout || ms('20s')), e)
          e.peer = muxrpc
          if (e.ping === true) {
            var p = ping({ serve: true, timeout: api.config.pingInterval || ms('10s') })

            _(
              p,
              goodbye(e.peer.swarm.ping(function (err) {
                console.log(err)
              }), 'pingGoodbye'),
              p
            )
          }
          e.end = muxrpc.close.bind(muxrpc, err || true, function (err) {
            if (err) console.log(err)
          })

          if (close === true) {
            muxrpc.close(err, function () {
              if (err) console.log(err)
            })
            return e
          }

          delete e.peer.close
          delete e.peer.createStream
          delete e.source
          delete e.sink

          return e
        },
        disconnection: function (e) {
          if (e.id != null && peers[e.id] != null) delete peers[e.id]
          delete e.sink
          delete e.source
          return e
        }
      })), peer.on({
        connection: function (e) {
          if (e.rpcCallback != null) {
            var c = e.rpcCallback;
            delete e.rpcCallback
            c(null, e)
          }
        }
      }), _.drain(notify, notify.abort))

    }
    return _ready.apply(null, [].slice.call(arguments))
  }

  source.peerID = util.encode(params.keys.publicKey, params.encoding)

  source.map = peer.map
  source.asyncMap = peer.asyncMap

  source.events = notify.listen
  source.encoding = params.encoding
  source.protoNames = peer.protoNames

  source.connect = function (addr, params, cb) {
    if (shutdown === true) {
      if (cb) cb(new Error('Peer Is Shutting Down'))
      return
    }
    if (typeof params === "function") {
      cb = params
      params = null

    }
    params = params || {}
    var id = URL.parse(addr).auth

    var found = false
    for (var i in peers) {
      var p = peers[i]
      if (p.peerID === id && found !== true) {
        found = true
        break
      }
    }

    if (found !== true && seen.indexOf(id) === -1) {
      seen.push(id)
      peer.connect(addr, params, function (err, connection) {
        if (params.ping === true) connection.ping = true

        if (seen.indexOf(id) !== -1) seen.splice(seen.indexOf(id), 1)
        if (cb) {

          if (err != null) return cb(err)

          connection.rpcCallback = cb
        }
      })
    }
  }

  source.end = function () {
    if(shutdown ===true)return
    shutdown = true
    peer.end.apply(peer, [].slice.call(arguments))
  }

  source.listen = peer.listen
  source.on = peer.on
  source.connections = peers
  source.combine = peer.combine

  source.addProtocol = function (protocol) {
    m.mount(_manifest, protocol.name.split('/'), protocol.manifest)
    m.mount(_api, protocol.name.split('/'), protocol)
  }

  source.addProtocol({
    name: 'swarm', manifest: mdm.manifest(doc), ping: function () {
      return goodbye(ping({ timeout: api.config.pingInterval || ms('10s') }), 'pingGoodbye')
    }
  })

  return source
}

Swarm.util = Peer.util