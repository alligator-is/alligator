var _ = require("icebreaker")
var utils = require('icebreaker-network/lib/util')
var Connect = require('icebreaker-network').connect;
var handshake = require('./handshake')
var MRPC = require('muxrpc')
var timeout = require("./timeout")
var ms = require("ms")


module.exports = function(addr,params, cb) {
  
  if (typeof params === "function") {
    cb = params
    params = {}
  }
  

  var cliInfo = params.info || require('./peerInfo.js')(params)
  if (params.encoding) config.encoding = params.encoding

  params.encoding = cliInfo.encoding

  Connect(addr, cliInfo, function (err, e) {
    if (err) return cb(err)
    var peerID = null
    if (e.address != null) {
      try {
        peerID = utils.parseUrl(e.address).auth || null
      }
      catch (err) {

      }
    }
    if (e.remote) peerID = utils.encode(new Buffer(e.remote, 'base64'), params.encoding || 'base64')
    delete e.remote

    if (peerID != null) e.peerID = peerID
    var t
    _(e, handshake({}, function (err, rest, remote) {
      if (err) return cb(err)

      var muxrpc = MRPC(remote, {})(null, null, e.id)
      var pinger = setInterval(function () {
        e.peer.dht.ping(function () {
         })
      }, ms("15s"))
      _(rest, t = timeout(muxrpc.createStream(), params.timeout || ms('40s'), function () {
        this.end()
      }.bind(e)), rest)

      e.peer = muxrpc
      e.end = muxrpc.close.bind(muxrpc, err || true, function (_err) {
        if (pinger) {
          clearInterval(pinger)
          pinger = null
        }

        if (_err) console.error(_err)
        t.end()
      })

      delete e.peer.close
      delete e.peer.createStream
      cb(null, e)
   
    }, false), e)
  })
}