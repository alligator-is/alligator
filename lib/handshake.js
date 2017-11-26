var handshake = require('pull-handshake')
var _ = require('icebreaker')
var ms = require('ms')

var isPlainObject = function (o) {
  return o && 'object' === typeof o
}

module.exports = function (local, cb, isListener) {
 var closed = false;
  var stream = handshake({ timeout: ms('40s') }, function (err) {
    if(closed==false)error(err)
  })
  
  var l = new Buffer.from(JSON.stringify(local))
  
  var shake = stream.handshake
  if (!isListener) {
    var buf = new Buffer(4)
    buf.writeUInt32BE(l.length, 0)
    shake.write(Buffer.concat([buf, l]))
  }

  function error(err) {
    if(closed===true) return
    if (err === true) err = new Error('unexpected end of handshake stream')
    shake.abort(err)
    if (err && cb){
      cb(err)
      delete cb
    } 
    closed=true
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
