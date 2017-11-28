var _ = require("icebreaker")
var utils = require('icebreaker-network/lib/util')
var Connect = require('icebreaker-network').connect;
var url = require('url')
var home = require('osenv').home
var name = process.env.alligator_appname || 'alligator'
var path = require("path")
var handshake = require('./handshake')
var MRPC = require('muxrpc')
var timeout = require("./timeout")
var ms = require("ms")
var os = require("os");

function defaultUrl(addr, params) {
  var p = url.parse(addr)
  if ((p.pathname == null || p.pathname.length === 1) && params.appKey != null) p.pathname = '/' + params.appKey
  params.encoding = params.encoding || 'base64'
  var auth 
  if (p.auth == null && params.keys.publicKey != null) auth = utils.encode(params.keys.publicKey, params.encoding)
  else if (p.auth == null && params.keys.id != null) auth = utils.encode(params.keys.id, params.encoding)
  
  if(auth)return p.format().replace(p.protocol+"//",p.protocol+"//"+encodeURIComponent(auth)+"@");
  
  return url.format(p)
}

module.exports = function(params, cb) {
 
  var addr = "shs+tcp+unix://" +  path.join("/",os.tmpdir(),name+".sock")

  if (typeof params === "function") {
    cb = params
    params = {}
  }

  var hp = path.join(home(), '.' + name)
  var peerInfo = require('./peerInfo.js').loadOrCreateSync(path.join(hp, 'peerInfo'))
  var cliInfo = require('./peerInfo.js')(params)
  if (params.encoding) config.encoding = params.encoding
  params.encoding = cliInfo.encoding
  Connect(defaultUrl(addr, peerInfo), cliInfo, function (err, e) {
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
        e.peer.dht.ping(function () { })
      }, ms("15s"))
      _(rest, t = timeout(muxrpc.createStream(), params.timeout || ms('40s'), function () {
        if (this.end) this.end()
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
      e.peer.dht.ping(function () { })
    }, false), e)
  })
}