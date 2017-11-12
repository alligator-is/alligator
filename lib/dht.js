var KBucket = require('k-bucket')
var ms = require('ms')
var url = require('url')
var paramap = require('pull-paramap')
var asyncInterval = require('asyncinterval')
var sort = require('pull-sort')
var valid = require("muxrpc-validation")()

function arbiter(incumbent, candidate) {
  if (incumbent.lastSeen > candidate.lastSeen) {
    return incumbent
  }

  return candidate
}

var path = require('path')

module.exports = function (api,_) {
  var notify = _.notify()
  var source = notify.listen()
  var config = api.config.dht || {}

  config.bucketSize = config.bucketSize || 8
  config.alpha = config.alpha || 3
  config.bucketRefresh = config.bucketRefresh || ms('60m')
  config.replicate = config.replicate || ms('60m')

  config.pingInterval = config.pingInterval || ms('15s')
  api.config.bootstrap = api.config.bootstrap || []
  if (api.config.bootstrap && api.config.bootstrap.length === 0) api.logger.warn('no bootstrap url configured')


  var bucket = new KBucket({ localNodeId: api.config.info.id, numberOfNodesPerKBucket: config.bucketSize, dontSplit: true, arbiter: arbiter })

  var addrs = []

  function connect(addresses, cb) {
    var retry = 3
    var _connect = function (addresses, cb) {
      retry--
      var addrs = addresses.slice(0).filter(function (addr) {
        return api.swarm.protoNames().indexOf(url.parse(addr).protocol) !== -1
      }).sort(function sortFunc(a, b) {
        var sortingArr = api.swarm.protoNames()
        return sortingArr.indexOf(url.parse(a[1]).protocol) - sortingArr.indexOf(url.parse(b[1]).protocol)
      })
      api.swarm.connect(addrs.shift(), {}, function cb2(err, con) {
        if (addrs.length > 0 && err != null) return api.swarm.connect(addrs.shift(), cb2)
        if (err != null && retry > 0) return _connect(addresses, cb)
        cb(err, con)
      })
    }
    _connect(addresses, cb)
  }

  function connectToClosest(map) {
    return _(source.findNode(api.id), _.filterNot(function (contact) {
      return api.id == contact.id
    }), paramap(function (contact, cb) {
      connect(contact.addrs, function (err, connection) {
        map(err, connection, cb)
      })
    }, config.alpha))
  }


  function bootstrap(cb) {

    var closest = source.findNode(api.id)

    if (closest.length === 0 && api.config.bootstrap.length > 0) {
      api.logger.debug('starting bootstraping on', api.id)

      connect(api.config.bootstrap, function (err, conn) {
        if (err) {
          api.logger.warn('unable to connect to bootstrap peer', err)
          if (cb) return cb()
          return
        }
        if (conn)
          ping(conn, function () {
            if (cb) cb(conn)
            api.logger.debug('bootstrapping on', api.id, 'is done')

          })
        else cb()
      })
      return
    }
    
    if (cb) cb()
  }


  var replicate = function (cb) {

    _(connectToClosest(function (err, connection, cb) {
      if (err) return cb()
      
      api.logger.info('replicating data from peer', connection.peerID)

      api.db.load(connection.peer.db, function (err) {
          if(connection.peer.db.read)return connection.peer.db.read(function(_err){
            api.logger.info('data from', connection.peerID, 'replicated')  
            if (cb) cb(err||_err)
          })

          api.logger.info('data from', connection.peerID, 'replicated')     
          if (cb) cb(err)          
      })

    }
    ), _.onEnd(function () {
      if (cb) cb()
    }))

  }

  var timers = {}
  timers.bootstrap = asyncInterval(function (next) { 
    if(timers.bootstrap){
      if (bucket.count() < 1) return bootstrap(function (conn) {
        next()
      })
      next()
   }}, ms('40s'))
  timers.ping = {}
  
  timers.refresh = asyncInterval(function (next) { 
    if(timers.refresh)refresh(next) }, config.bucketRefresh)
  timers.replicate = asyncInterval(function (next) { if(timers.replicate)replicate(next) }, config.replicate)

  function ping(e, cb) {
    api.logger.debug('ping peer ', e.peerID)
    e.peer.dht.ping(function (err, addr) {
      api.logger.debug('pinged peer ', e.peerID)
      if (err || !Array.isArray(addr)) return e.end(err)
      if (addr.length == 0) {
        if (cb) return cb()
        return
      }
      if (e.remoteAddress) {
        addr = addr.map(function (addr) {
          var u = api.util.parseUrl(addr)
          u.hostname = api.util.parseUrl(e.remoteAddress).hostname
          delete u.host
          return u.format()
        })
      }

      if (e.address) {
        addr = addr.map(function (addr) {
          var u = api.util.parseUrl(addr)
          u.hostname = api.util.parseUrl(e.address).hostname
          delete u.host
          return u.format()
        }
        )
      }
      return _(addr, _.unique(), _.collect(function (err, addrs) {
        if (err) return e.end(err)
        api.logger.debug('peer ', e.peerID, ' pinged', arguments, 'on', api.id)
        bucket.add({ id: api.util.decode(e.peerID, api.config.info.encoding), addrs: addrs, lastSeen: new Date().getTime() })

        api.logger.debug('peer ', e.peerID, ' pinged')
        if (isCloser(e.peerID) && e.isCloser != true) { 
            e.isCloser = true 
            notify({ type: 'closer', id: e.id, peerID: e.peerID, addrs: addrs, peer: e.peer, protocols: e.protocols, manifest: e.manifest 
          }) 
        }
        if (!isCloser(e.peerID) && e.isCloser != false) {
          e.isCloser = false
          notify({ type: 'notcloser', id: e.id, peerID: e.peerID })
        }

        if (cb) cb()

      }))
    })
  }

  function refresh(cb) {
    cb = cb || function () { }
    var update = function (cb) {
      api.logger.info('starting bucket refresh', config.bucketSize)
      _(
        connectToClosest(function (err, connection, cb) {
          if (err) return cb()
          connection.peer.dht.findNode(api.id, function (err, peers) {
            if (err) return cb()
            _(peers, paramap(function (item, cb) {

              connect(item.addrs, function (err, conn) {
                if (err) return cb(null)
                if (!conn) return cb(null)
                conn.peer.dht.ping(function () {
                  cb(null, item)
                })
              })
            }), _.onEnd(cb))
          })

        }), _.onEnd(function () {
          api.logger.info('bucket refresh done', bucket.count())
          api.logger.info("bucket", Object.keys(api.swarm.connections).length)
          if (cb) cb()
        }))
    }

    if (bucket.count() < 1) return bootstrap(function (conn) {
      if (conn) return update(cb)
      if (cb) cb()
    })

    update(cb)
  }

  var p = []

  function isCloser(id) {
    var closest = source.findNode(api.id)
    return closest.map(function (item) {
      return item.id
    }).indexOf(id) !== -1
  }

  _(api.events(),api.events.on({change:function(e){
      bucket.add({ id: api.util.decode(e.doc._id, api.config.info.encoding), addrs: e.doc.addrs, lastSeen: e.doc.addrs })
    },end:function(){}})
  )
  
  _(api.swarm.events(),
    api.events.on({
      ready: function (e) {
        addrs = e.address

        refresh(function () {
          replicate()
        })

        notify({ type: 'ready' })
      },
      connection: function (e) {
        ping(e, function () {
          if (this.peer) timers.ping[this.id] = setInterval(function () {
            if (source.get(this.peerID) == null) return
            if (!isCloser(this.peerID)) return

            ping(this)
          }.bind(this), config.pingInterval)
        }.bind(e))
      },
      disconnection: function (e) {
        if (timers.ping[e.id]) {
          clearInterval(timers.ping[e.id])
          delete timers.ping[e.id]
          timers.ping[e.id] = null
        }

        var found = false
        for (var i in api.swarm.connections) {
          var p = api.swarm.connections[i]
          if (p.peerID === e.peerID) {
            found = true
            break
          }
        }
        if (e.peerID && found === false) bucket.remove(api.util.decode(e.peerID, api.config.info.encoding))

        if (isCloser(e.peerID) && e.isCloser != false) {
          e.isCloser = false
          notify({ type: 'notcloser', id: e.id, peerID: e.peerID })
        }
        api.logger.info('disconnection from', e.peerID, 'on ', api.id)  
      },
      end: function () {
        notify.end()
        source.end()
      }
    }))

  source.path = 'dht'

  source.manifest = {
    findNode: 'sync',
    ping: 'sync'
  }

  source.get = function (key) {
    var item = bucket.get(api.util.decode(key, api.config.info.encoding))
    if (!item) return
    return { id: api.util.encode(item.id, api.config.info.encoding), addrs: item.addrs }
  }

  source.ping = valid.sync(function () {
    return addrs
  })

  source.findNode = valid.sync(function (key) {
    return bucket.closest(api.util.decode(key, api.config.info.encoding), config.bucketSize).map(function (item) {
      return { id: api.util.encode(item.id, api.config.info.encoding), addrs: item.addrs }
    }).filter(function (item) {
      return item.id !== key
    })
  },["string"])

  source.findByPath = function (path, cb) {
    var bucket2 = new KBucket({ arbiter: arbiter, localNodeId: api.config.info.id, numberOfNodesPerKBucket: api.config.bucketSize, dontSplit: true })
    _(api.db.ls({ include_docs: true, old: true, live: false }), _.filter(function (e) {
      return e.doc.protocols && e.doc.protocols.indexOf(path) !== -1
    }), sort(function (a, b) {
      return a.doc.lastSeen < b.doc.lastSeen
    }), _.map(function (e) {
      var doc = e.doc
      bucket2.add({ id: api.util.decode(doc._id, api.config.info.encoding), addrs: doc.addrs, lastSeen: doc.lastSeen })
      return doc
    }), _.onEnd(function (err) {
      if (err) return cb(err)
      cb(null, bucket2.closest(api.util.decode(api.id, api.config.info.encoding), config.bucketSize).map(function (item) {
        return { id: api.util.encode(item.id, api.config.info.encoding), addrs: item.addrs }
      }).filter(function (item) {
        return item.id !== api.id
      }))

    }))

  }

  source.connectTo = function(path,cb){
    source.findByPath(path,function(err,peers){
      if(err)return cb(err)
      var addrs = []
      peers.forEach(function(p) { addrs = addrs.concat(p.addrs)})
      connect(addrs,cb)
    })
  }

  source.end = function (err) {
    for (var i in timers) {
      if (timers[i] && timers[i] != null && _.isFunction(timers[i].clear)) {
        timers[i].clear()
        timers[i] = null
      }
    }
    
    for (var t in timers.ping) {
      if(timers.ping[t] !=null){
        clearInterval(timers.ping[t])
        timers.ping[t] = null
      }      
    }

    notify.end() 
  }

  return source
}