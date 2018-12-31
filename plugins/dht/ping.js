
const { api, _ } = require("../../")
const ms = require('ms')
const util = require('icebreaker-network/lib/util')

api.config.pingInterval = api.config.pingInterval || ms('15s')

const events = _.events()

const end = events.end

class Intervals {
  constructor() {
    this.timers = {}
    this.closing = false
  }

  start(id, func, time) {
    if (this.closing) return
    if (this.timers[id]) this.stop(id)
    const self = this
    this.timers[id] = setInterval(() => {
      if (self.closing == true) return self.stop(id)
      func()
    }, time)
  }
  stop(id) {
    if (this.timers[id]) {
      clearInterval(this.timers[id])
      delete this.timers[id]
    }
  }

  stopAll() {
    this.closing = true
    for (var t in Object.keys(this.timers)) {
      if (this.timers[t]) {
        clearInterval(this.timers[t])
        delete this.timers[t]
      }
    }
  }
}

const timers = new Intervals()

events.end = (err) => {
  timers.stopAll()
  end(err)
}

function isCloser(id, cb) {
  const closer = api.dht.findNode(api.id).map((item) => { return item.id }).indexOf(id) !== -1
  api.friends.isFriend(id, (err, isFriend) => {
    if (err) return cb(err, false)
    cb(null, isFriend && closer)
  })
}

api.dht.ping = function ping(e, cb) {

  if (api.shutdown === true) return cb(new Error("'peer cannot ping " + e.peerID + ", because it is shutting down'"));

  api.log.debug('ping peer', e.peerID, "on", api.id)

  if (!e.peer.protoNames) return cb(new Error("peer.protoNames not found"))

  e.peer.protoNames((err, protos) => {
    api.log.debug('pinged peer ', e.peerID, "on", api.id)

    if (err || !Array.isArray(protos)) return cb(err || new Error("result of protoNames is not a array"))

    if (protos.length == 0) return cb(new Error("peer " + e.peerID + "listening on no protocols"))

    if ((e.address != null || e.remoteAddress != null)) {
      let address = e.address || e.remoteAddress
      const u = util.parseUrl(address)
      u.auth = e.peerID
      delete u.host
      address = u.format()

      const addr = protos.map((proto) => {
        return address.replace(e.protocol, proto.name).replace(u.port, proto.port)
      })

      return _(
        addr,
        _.unique(),
        _.collect((err, addrs) => {
          
          if (err) return cb(err)
       
          const lastSeen = new Date().getTime();
          api.dht.bucket.add({ id: util.decode(e.peerID, api.config.encoding), addrs: addrs, lastSeen: lastSeen })

          isCloser(e.peerID, (err, closer) => {
            
            if (closer && e.isCloser != true) {
              e.isCloser = true
              events.emit({ type: 'closer', id: e.id, peerID: e.peerID, addrs: addrs, peer: e.peer, lastSeen: lastSeen })
            }
            
            if (!closer && e.isCloser != false) {
              e.isCloser = false
              events.emit({ type: 'notcloser', id: e.id, peerID: e.peerID, addrs: addrs, peer: e.peer, lastSeen: lastSeen })
            }

            return cb()
          
          })

      }))
    }

    return cb(new Error("error no address"))
  })
}

_(
  api.events(),
  api.events.on({

  connection: (e) => {

    if (e.protocol.indexOf("+unix") !== -1) return

    api.dht.ping(e, (err) => {
      if (err) return;
      if (e.peer)
        timers.start(e.id, () => {
          if (api.dht.get(e.peerID) == null) return timers.stop(e.id);
          isCloser(e.peerID, (err, closer) => {
            if (!closer) {
              if (e.isCloser != false) {
                e.isCloser = false
                events.emit({ type: 'notcloser', id: e.id, peerID: e.peerID })
              }
              return
            }
            api.dht.ping(e, (err) => { })
          })
        }, api.config.pingInterval)
    })

    const end = e.end
    e.end =  () => {
      if (e.peerID) api.dht.bucket.remove(util.decode(e.peerID, api.config.encoding))
      timers.stop(e.id)
      end()
    }
  
  },

  disconnection: (e) => {
    timers.stop(e.id)
    
    if (e.peerID) api.dht.bucket.remove(util.decode(e.peerID, api.config.encoding))
    
    isCloser(e.peerID, (err, closer) => {
      if (!closer && e.isCloser != false) {
        e.isCloser = false
        events.emit({ type: 'notcloser', id: e.id, peerID: e.peerID })
      }
    })

  },

  end: function () {
    timers.stopAll()
  }

}))

events.emit({ type: "ready" })

module.exports = events
