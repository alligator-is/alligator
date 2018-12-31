const { _ } = require('../')
const onEnd = require('./onEnd')

module.exports = function (d, time, onTimeout) {
  let ts = Date.now()
  time = time || ms('20s')
  
  let timer = setInterval(function () {
    if (Date.now() - ts >= time) end()
  }, time)

  const end = () => {
    clearInterval(timer)
    timer = null
    closed = true
    onTimeout()
  }

  const lastChange = () => {
    return _.asyncMap((data, cb) => {
      ts = Date.now()
      cb(null, data)
    })
  }

  const r = onEnd({ source: _(d.source, lastChange()), sink: _(lastChange(), d.sink) }, end)
  r.end = end
  return r
}