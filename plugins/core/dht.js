const { api, _, Action } = require("../../")
const KBucket = require('k-bucket')
const ms = require('ms')
const util = require('icebreaker-network/lib/util')
const paramap = require('pull-paramap')
const url = require("url")

function arbiter(incumbent, candidate) {
  if (incumbent.lastSeen > candidate.lastSeen) {
    return incumbent
  }

  return candidate
}

function interval(func, time) {
  let timer
  let close = false

  timer = setTimeout(function next() {
    func(() => {
      clearTimeout(timer)
      timer = null
      if (close == true) return;
      timer = setTimeout(next, time)
    })
  }, time)

  return {
    end: () => {
      close = true
      clearTimeout(timer)
      timer = null;
    }
  }
}

class Timers {
  constructor() {
    this.timers = {}
    this.id = 0
    this.closing = false
  }

  start(func, time) {
    if (this.closing) return;
    this.timers[this.id++] = interval(func, time)
  }

  stop() {
    this.closing = true

    for (let i in Object.keys(this.timers)) {
      this.timers[i].end()
      delete this.timers[i]
    }

    if (Object.keys(this.timers).length > 0) this.stop()
  }
}

module.exports = () => {

  api.config.bootstrap = api.config.bootstrap || []
  if (api.config.bootstrap && api.config.bootstrap.length === 0) api.log.warn('no bootstrap url configured')

  api.config.bucketSize = api.config.bucketSize || 8
  api.config.alpha = api.config.alpha || 3
  api.config.bucketRefresh = api.config.bucketRefresh || ms('60m')
  api.config.replicate = api.config.replicate || ms('60m')
  api.config.bootstrap = api.config.bootstrap || []

  const bucket = new KBucket({ localNodeId: api.config.keys.publicKey, numberOfNodesPerKBucket: api.config.bucketSize, arbiter: arbiter })

  api.dht = {}
  api.dht.bucket = bucket

  function connectToClosest(map) {
    return _(
      api.dht.findNode(api.id),
      _.filterNot((contact) => {
        return api.id == contact.id
      }),
      paramap((contact, cb) => {
        api.connect(contact.addrs, function (err, connection) {
          map(err, connection, cb)
        })
      },
        api.config.alpha)
    )
  }

  function bootstrap(cb) {
    const closest = api.dht.findNode(api.id)

    if (closest.length === 0 && api.config.bootstrap.length > 0) {
      api.log.debug('starting bootstraping on', api.id)

      api.connect(api.config.bootstrap, (err, conn) => {
        if (err) {
          api.log.warn('unable to connect to bootstrap peer', err)
          return cb()
        }
        api.dht.ping(conn, (err) => {
          if (err) return cb()
          cb(conn)
          api.log.debug('bootstrapping on', api.id, 'is done')
        })
      })
      return
    }

    cb()
  }

  function bucketRefresh(cb) {
    const update = (cb) => {
      api.log('starting bucket refresh', api.config.bucketSize)
      _(
        connectToClosest((err, connection, cb) => {
          if (err) return cb()
          connection.peer.findNode(api.id, (err, peers) => {
            if (err) return cb()
            _(peers, _.asyncMap((item, cb) => {

              api.connect(item.addrs, (err, conn) => {
                if (err) return cb(null)
                if (!conn) return cb(null)
                api.dht.ping(conn, () => {
                  cb(null, item)
                })
              })
            }), _.onEnd(cb))
          })

        }),
        _.onEnd(() => {
          api.log('bucket refresh done', bucket.count())
          if (cb) cb()
        }))
    }

    if (bucket.count() < 1) return bootstrap((conn) => {
      if (conn) return update(cb)
      return cb()
    })

    update(cb)
  }

  function replicate(next) {
    _(connectToClosest((err, connection, cb) => {
      if (err) return cb()
      api.log.info('replicating data from peer', connection.peerID)
      events.emit(Object.assign({}, connection, { type: "replicate" }))
      cb()
    }
    ), _.onEnd(next))
  }

  const events = _.events()
  const timers = new Timers()

  let addrs = api.config.listen || []
  
  if(addrs.length>0)
  api.actions.protoNames = Action({
    type: "async",
    desc: "Returns protocol names and ports listened to by the server",
    run: (cb) => {
      cb(null, api.peer.protoNames()
        .filter((i) => {
          for (let attr of addrs) if (attr.indexOf(i) === 0) return true
          return false
        })
        .filter((addr) => {
          return addr.indexOf("unix") == -1
        })
        .map((i) => {
          for (let attr of addrs) if (attr.indexOf(i) === 0) return {
            name: i,
            port: url.parse(attr).port
          }
        })
      )
    }
  })

  api.dht.get = (key) => {
    const item = bucket.get(util.decode(key, api.config.encoding))
    if (!item) return
    return { id: util.encode(item.id, api.config.encoding), addrs: item.addrs }
  }

  api.dht.findNode = api.actions.findNode = Action({
    type: "sync",
    input: "string",
    desc: "returns the nearest keys and addresses for the input key",
    run: (key) => {
      return bucket.closest(util.decode(key, api.config.encoding), api.config.bucketSize)
        .map((item) => {
          return { id: util.encode(item.id, api.config.encoding), addrs: item.addrs }
        })
        .filter((item) => {
          return item.id !== key
        })
    }
  })


  _(api.events(), api.events.on({
    ready: () => {

      timers.start(bootstrap, ms("1m"))
      timers.start(bucketRefresh, api.config.bucketRefresh)
      timers.start(replicate, api.config.replicate)

      bucketRefresh(() => {
        replicate(() => { })
      })
    },
    end: () => {
      timers.stop()
    }
  }))

  const end = events.end
  events.end = () => {
    timers.stop()
    end()
  }

  events.emit({ type: "ready" })

  return events

}