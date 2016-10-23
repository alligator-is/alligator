var _ = require('icebreaker')
var Swarm = require('./swarm')
var Kad = require('./kad')
var url = require('url')
var cl = require('chloride')

function Peer(config) {
  if (!(this instanceof Peer)) return new Peer(params)
  this.config = config
  this.config.info = this.config.info || PeerInfo()
  this.state = 'ended'
  this.util = Swarm.util
  this.id = this.util.encode(config.info.id, config.info.encoding)
}

var proto = Peer.prototype = {}

proto.start = function (cb) {
  if (this.state === 'ended') {
    this.state = 'start'
    var self = this

    self.swarm = new Swarm(this)
    self.kad = Kad(this)
    self.swarm.addProtocol(self.kad)

    self.config.listen.filter(function (addr) {
      return self.swarm.protoNames().indexOf(url.parse(addr).protocol) !== -1
    })
      .forEach(function (addr) {
        self.swarm.listen(addr)
      })

    _(self.swarm, self.swarm.on({
      ready: function (e) {
        self.kad.start(function () {
          self.state = e.type
          if (cb) cb(null, e)
          cb = null
        })
      },
      end: function (err) {
        this.state = 'ended'
      }
    })
    )
  }
}

proto.stop = function (cb) {
  var self = this

  if (this.kad === null || this.swarm === null) return

  self.kad.stop(function () { 
      self.kad = null
      
    if (cb) _(self.swarm.events(), self.swarm.on({
      end: function (err) {
        if (cb) cb(err)
        cb = null
        self.state = 'ended'
        self.swarm = null;
        self.kad = null
      }
    }))

    if (self.swarm != null && self.swarm.end !=null) {
      self.swarm.end()
      delete self.swarm.end
    }
  })
}

module.exports = Peer

var PeerInfo = module.exports.PeerInfo = function (params) {
  params = params || {}
  var keys = params.keys || cl.crypto_sign_keypair()
  var l

  return {
    appKey: params.appKey || 'alligator@1.0.0',
    encoding: params.encoding || 'base58',
    keys: keys,
    id: keys.publicKey
  }
}