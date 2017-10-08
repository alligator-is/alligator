var onEnd = require('./onEnd')
var _ = require('icebreaker')

module.exports = function (d, time, onTimeout) {
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

    var r = onEnd({source:_(d.source,lastChange()),sink:_(lastChange(),d.sink)},end)
    r.end = end
    return r
  }