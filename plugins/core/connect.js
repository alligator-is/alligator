const { api, _ } = require("../..")
const mutexify = require('mutexify')
const url = require("url")

module.exports = () => {

  api.connections = {}

  let count = 0;

  _(
    api.events(),
    api.events.on({
      connection: (e) => {
        e.id = ++count
        api.connections[e.id] = e
      },
      disconnection: (e) => {
        delete api.connections[e.id]
      },
      end: () => {
      }
    })
  )

  let seen = {}

  function connect(addr, params, cb) {
    if (_.isFunction(params)) {
      cb = params
      params = null
    }

    params = params || {}

    const id = url.parse(addr).auth

    const _cb = function (...args) {
      if (seen[id]) delete seen[id]
      if (cb) cb(...args)
    }

    if (seen[id]) return seen[id]((release) => {
      connect(addr, params, release.bind(null, _cb))
    })


    for (let k in api.connections) {
      let c = api.connections[k]
      if (c.peerID === id) return _cb(null, c)
    }
    
    if(addr.indexOf("+unix") === -1 && !url.parse(addr).port) return _cb(new Error("connection not found"))
 
    if (!seen[id]) seen[id] = mutexify()
    seen[id](function (release) {
      api.peer.connect(addr, params, release.bind(null, _cb))
    })
  }

  api.connect = function (addresses, cb) {
    
    if (api.shutdown === true) return cb(new Error("'peer cannot create new connections, because it is shutting down'"));
    if (_.isString(addresses)) addresses = [addresses]
    
    const addrs = addresses.slice(0).filter(function (addr) {
      return api.peer.protoNames().indexOf(url.parse(addr).protocol) !== -1
    })
    .sort(function sortFunc(a, b) {
      const sortingArr = api.peer.protoNames()
      return sortingArr.indexOf(url.parse(a[1]).protocol) - sortingArr.indexOf(url.parse(b[1]).protocol)
    })
    
    if (addrs.length === 0 && addresses.length > 0) return cb(new Error("protocol not found in Address:" + JSON.stringify(addresses)))
    
    connect(addrs.shift(), {}, function cb2(err, con) {
      if (addrs.length > 0 && err != null) return connect(addrs.shift(), cb2)
      cb(err, con)
    })
  }
  
}