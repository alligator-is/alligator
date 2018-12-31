const KeyPair = require('icebreaker-rpc').KeyPair

var fs = require('fs')

const PeerInfo = function PeerInfo(params) {
  params = params || {}
  if (!(this instanceof PeerInfo)) return new PeerInfo(params)
  this.keys = params.keys || KeyPair.generate()
  this.appKey = params.appKey || 'alligator@1.0.0'
  this.encoding = params.keys && params.keys.encoding ? params.keys.encoding : params.encoding || 'base58'
}

PeerInfo.prototype = {}

PeerInfo.prototype.toJSON = function () {
  return JSON.stringify({
    appKey: this.appKey,
    keys: KeyPair.encode(this.keys, this.keys.encoding || this.encoding)
  })
}


PeerInfo.fromJSON = function (source) {
  const params = JSON.parse(source)
  params.keys = KeyPair.decode(params.keys, params.keys.encoding || 'base58')
  return new PeerInfo(params)
}

PeerInfo.loadOrCreateSync = function (file, params) {
  try {
    return PeerInfo.fromJSON(fs.readFileSync(file))
  }
  catch (err) {
    fs.writeFileSync(file, PeerInfo(params).toJSON())
    return PeerInfo.fromJSON(fs.readFileSync(file))
  }
}

module.exports = PeerInfo