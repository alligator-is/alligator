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
var doc = require('./apidocs').swarm
var paramap = require('pull-paramap')
var abortable = require('pull-abortable')
var handshake = require('./handshake')

function para(events) {
  return paramap(function handle(e, cb) {
    if (events[e.type] != null && typeof events[e.type] === 'function') return events[e.type].call(this, e, function (d) {
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
  params.encoding = params.encoding || 'base58'

  params.keys = clone(params.keys)
  var peer = Peer(params)
  var peers = {}
  var seen = []
  var _manifest = {}
  var manifest = manifest = {}

  var notify = Notify()
  var _ready = false
  var queue = []
  var gid = 0
  var shutdown = false
  api.config.swarm = api.config.swarm || {}
  var _api = api

  var timeout = function (d, time, onTimeout) {
    var ts = Date.now()
    time = time || ms('20s')
    var closed = false
    var timer = setInterval(function () {
      if (Date.now() - ts >= time) end()

    }, time)

    var end = function () {
      if (closed === true) return
      clearInterval(timer)
      closed = true
      onTimeout()
    }

    var lastChange = function () {
      return _.asyncMap(function (data, cb) {
        ts = Date.now()
        cb(null, data)
      })
    }

    return {
      source: _(d.source, abortable(end), lastChange()),
      sink: _(lastChange(), abortable(end), d.sink)
    }
  }

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
              api.logger.error('manifest handshake error', err)
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
            if (shutdown === true) { err = 'peer cannot accept new connections, because it is shutting down' close = true }
            e.id = ++gid
            peers[e.id] = e
            e.protocols = []
            Object.keys(remote).forEach(function (i) { e.protocols.push(i) })
            e.manifest = e.remote

            var muxrpc = MRPC(remote, _manifest)(_api, null, e.id)

            _(rest, timeout(muxrpc.createStream(), api.config.swarm.timeout = api.config.swarm.timeout || ms('40s'), function () {
              if (this.end) this.end()
              close = true
            }.bind(e)), rest)
            e.peer = muxrpc
            e.end = muxrpc.close.bind(muxrpc, err || true, function (err) {
              if (err) api.logger.error(err)
            })
            if (close === true) {
              muxrpc.close(err, function () {
                if (err) api.logger.warn(err)
              })
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

  var protocols = []

  source.addProtocol = function (protocol) {
    if (protocol.path == null && protocol.manifest == null) return
    protocols.push({ path: protocol.path, manifest: protocol.manifest })
    m.mount(_manifest, protocol.path.split('/'), protocol.manifest)
    m.mount(_api, protocol.path.split('/'), protocol)
  }
  source.path = 'swarm'
  source.manifest = manifest
  source.addProtocol(source)
  return source
}

Swarm.util = Peer.util