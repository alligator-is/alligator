var _ = require('icebreaker')
var path = require('path')
var ms = require('ms')
var paramap = require('pull-paramap')
var asyncInterval = require('asyncinterval')
var mkdirp = require('mkdirp')
var PouchDB = require('pouchdb')
var path = require('path')
var Abortable = require('pull-abortable')
var KBucket = require('k-bucket')

var PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-upsert'))

var clone = require('lodash.clonedeep')

module.exports = function (api, name) {
  var name = name || 'db'
  var notify = _.notify()
  var source = notify.listen()
  source.events = notify.listen
  var dir = path.join(api.config.path, api.id, name)

  var db = new PouchDB(dir)

  db.setMaxListeners(100)

  source.path = name
  source.manifest = { 'ls': 'source' }

  var update = function (e) {
    db.upsert(e.peerID, function (doc) {
      doc.lastSeen = Date.now()
      doc.addrs = e.addrs
      doc.protocols = e.protocols.slice(0)
      doc.manifest = e.manifest
      doc.type = 'peer'
      return doc
    }).then(function (res) {
      api.logger.debug("db update ", res)
    })
      .catch(function (err) {
        api.logger.error("db upsert error", err)
      })
  }

  var Live = require('pull-live')

  function changes(opts) {
    opts = clone(opts)
    opts.live = true
    opts.since = 'now'
    delete opts.limit
    var close = false
    function complete() { done() }

    function change(change) {
      if (change) push.push(change)
    }

    function done(err) {
      if (close === false) {
        changes.removeListener('complete', complete)
        changes.removeListener('error', done)
        changes.removeListener('change', change)
      }

      if (close === true) return
      changes.cancel()
      push.end(err || true)
      close = true
    }

    var push = _.pushable(done)
    var changes = db.changes(opts)

    changes.on('change', change).on('complete', complete)
      .on('error', done)
    return push
  }

  var c
  _(c = changes({ live: true, include_docs: true }), _.drain(function (item) {
    notify(item)
  }, function () { }))

  function filter(e) {
    return e.doc.type === 'peer' && e.doc.lastSeen != null
  }

  source.ls = Live(function old(opts) {
    opts = opts || {}
    opts = clone(opts)
    opts.live = opts.live || false
    opts.old = opts.old || true
    opts.limit = 100
    opts.since = opts.since || 0
    var _filter = opts.filter || filter
    delete opts.filter

    return _(function read(end, cb) {
      if (end) return cb(end)
      var changes = db.changes(opts, function (err, change) {
        if (err) {
          changes.cancel()
          changes = null
          return cb(end = true, null)
        }
        opts.since = change.last_seq
        if (end != true && change.results.length > 0) return cb(null, change.results)
        if (change.results.length < opts.limit) { 
          changes.cancel() 
          changes = null
          return cb(end = true, null) }
      })

    }, _.flatten(), _.filter(_filter))

  }, function (opts) {
    opts.filter = opts.filter || filter
    return _(notify.listen(), _.filter(opts.filter))
  })

  function upsert(item, cb) {
    if (!filter({ doc: item })) return cb(null)
    db.upsert(item._id, function (doc) {
      if (item.lastSeen > doc.lastSeen || doc.lastSeen == null) {
        doc.lastSeen = item.lastSeen
        doc.addrs = item.addrs
        doc.protocols = item.protocols
        doc.manifest = item.manifest
        doc.type = 'peer'
      }
      else return false
      return doc
    }, cb)
  }

  source.load = function (rdb, cb) {
    _(rdb.ls({ include_docs: true, old: true, live: false }), paramap(function (item, cb) {
      if (filter(item)) return cb(null)
      upsert(item.doc, function (err, info) {
        cb(null, info)
      })
    }, 10),
      _.onEnd(cb))
  }

  var ls = {}

  var addr = []

  _(api.events(), api.events.on({
    closer: function (e) {
      update(e)
      var ended = false
      function done(err) {
        if (ended == true) return
        delete ls[e.id]
        ended = true
      }

      if (!ls[e.id]) {
        ls[e.id] = Abortable(done)
        _(api.swarm.connections[e.id].peer.db.ls({ old: false, live: true, include_docs: true }), ls[e.id], _.drain(function (change) {
          upsert(change.doc, function () {})
        }, function (err) {
          done(err)
        }))
      }
      api.logger.debug('peer is closer', e.peerID)
    },
    notcloser: function (e) {
      if (ls[e.id]) ls[e.id].abort(true)
      api.logger.debug('peer is not closer', e.peerID)
    },
    end: function () {

    }
  }))

  source.end = function () {
    c.end()
    notify.end()
  }

  notify({ type: 'ready' })
 
  return source

}