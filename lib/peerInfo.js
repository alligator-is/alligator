var cl = require('chloride')
var util = require('./swarm').util
var fs = require('fs')

var PeerInfo = function PeerInfo(params) {
  params = params || {}
  if (!(this instanceof PeerInfo)) return new PeerInfo(params)
  this.keys = params.keys || cl.crypto_sign_keypair()
  this.appKey = params.appKey || 'alligator@1.0.0',
    this.encoding = params.encoding || 'base58',
    this.id = this.keys.publicKey
}

PeerInfo.prototype = {}

PeerInfo.prototype.toJSON = function () {
  return JSON.stringify({
    id: util.encode(this.keys.publicKey, this.encoding),
    encoding: this.encoding,
    appKey: this.appKey,
    keys: {
      publicKey: util.encode(this.keys.publicKey, this.encoding),
      secretKey: util.encode(this.keys.secretKey, this.encoding)
    }
  })
}


PeerInfo.fromJSON = function (source) {

  var params = JSON.parse(source)
  params.keys.publicKey = util.decode(params.keys.publicKey, params.encoding || 'base58')
  params.keys.secretKey = util.decode(params.keys.secretKey, params.encoding || 'base58')

  return new PeerInfo(params)
}

PeerInfo.loadOrCreateSync = function (file) {
  try {
    return PeerInfo.fromJSON(fs.readFileSync(file))
  }
  catch (err) {
    fs.writeFileSync(file, PeerInfo().toJSON())
    return PeerInfo.fromJSON(fs.readFileSync(file))
  }
}

module.exports = PeerInfo