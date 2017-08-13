var handshake = require('pull-handshake')
var _ = require('icebreaker')
var ms = require('ms')
var isPlainObject = function (o) {
  return o && 'object' === typeof o
}

module.exports = function (local, cb, isListener) {
  var stream = handshake({ timeout: ms('40s') }, function (err) {
    if (err) console.error(err.message || err)
  })

  var shake = stream.handshake
  var l = new Buffer.from(JSON.stringify(local))

  if (!isListener) {
    var buf = new Buffer(4)
    buf.writeUInt32BE(l.length, 0)
    shake.write(Buffer.concat([buf, l]))
  }

  function error(err) {
    if (err === true) err = new Error('unexpected end of handshake stream')
    if (err) cb(err)
    return shake.abort(err)
  }

  shake.read(4, function (err, data) {
    if (err) return error(err)
    var len = data.readUInt32BE(0)
    shake.read(len, function (err, data) {
      if (err) return error(err)
      var meta
      try {
        meta = JSON.parse(data.toString())
        if (!isPlainObject(meta)) return error(true)
      } catch (e) {
        return error(e)
      }
      if (isListener) {
        var buf = new Buffer(4)
        buf.writeUInt32BE(l.length, 0)
        shake.write(Buffer.concat([buf, l]))
      }
      cb(null, shake.rest(), meta || {})
    })
  })

  return {
    source: stream.source,
    sink: stream.sink
  }
}
