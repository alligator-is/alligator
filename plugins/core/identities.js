const { api, _, Action } = require("../../")
const path = require('path')
const dir = path.join(api.config.path, "identities","data")
const Flume = require('flumedb')
const OffsetLog = require('flumelog-offset')
const codec = require('flumecodec')
const Reduce = require('flumeview-reduce')
const Abortable = require('pull-abortable')
const util = require('icebreaker-network/lib/util')

module.exports = () => {

  const db = Flume(OffsetLog(dir, { codec: codec.json })).use('view', Reduce(1, function (acc, item) {
    if (acc == null) acc = {}
    if (item.id) {
      if (acc[item.id] && item.ts > acc[item.id].ts) acc[item.id] = item
      if (!acc[item.id]) acc[item.id] = item
      if (acc[item.id].delete === true) delete acc[item.id]
    }
    return acc
  }))

  api.identities = {}
  api.actions.identities = {}

  api.identities.put = api.actions.identities.put = Action({
    type: "async",
    input: {id:"string",name:"string?",meta:"object?",groups:"array|string?"},
    desc: "adds or updates the identity" ,
    run: (identity, cb) => {
      
      try {
        util.decode(identity.id,api.config.encoding)  
      } catch (err) { 
        return cb(err) 
      }    
      
      if(_.isString(identity.groups))identity.groups = [identity.groups]
      if (db.closed) return cb(Error('cannot call: api.identities.put, flumedb instance is closed'))
      db.view.get((err, identities) => {
        if (err) return cb(err)         
        if(identities){
          if(!identity.groups && identities[identity.id] && identities[identity.id].groups) identity.groups = identities[identity.id].groups
          
          if(identities[identity.id] ){
            const obj = {}
            Object.assign(obj,identities[identity.id])
            delete obj.ts
            if(JSON.stringify(obj)  === JSON.stringify(identity)) return cb(null, identities[identity.id])
          }
        }
      
        
        identity.ts = Date.now()
        
        db.append(identity, (err, sec) => {
          if (db.closed) return cb(Error('cannot call: api.identities.put, flumedb instance is closed'))
          if (err) return cb(err)
          db.view.get((err, res) => {
            if (err) return cb(err)
            cb(null, res && res[identity.id] ? res[identity.id] : identity)
          })
        })
      })
    }
  })

  api.identities.remove = api.actions.identities.remove = Action({
    type: "async",
    input: "string",
    desc: "remove the identity by id" ,
    run: (id, cb) => {
      try {
        util.decode(id,api.config.encoding)  
      } catch (err) { 
        return cb(err) 
      }
      if (db.closed) return cb(Error('cannot call: api.identities.remove, flumedb instance is closed'))
    
        db.view.get(function(err,identities){
          if(err) cb(err) 
        if(!identities[id]) return cb(null,true)  
        db.append({
        id: id,
        ts: Date.now(),
        delete: true
      }, (err, sec) => {
        if (err) return cb(err)
          cb(null,true)
      })
    })
    }
  })

  api.identities.get =  Action({
    type: "async",
    input: "string",
    desc: "gets the identity by id" ,
    run:function(id,cb){
      if (db.closed) return cb(Error('cannot call: api.identities.get, flumedb instance is closed'))
     
      db.view.get((err,identities)=>{
        if(err) return cb(err)
        if(!(identities && identities[id])) return cb(new Error("Identity " + id +" not found!"))
        cb(null,identities[id])
      })
  }
})

  api.identities.ls = api.actions.identities.ls = Action({
    type: "source",
    input: { live: "boolean|string", old: "boolean|string" },
    desc: "Returns all identities",
    usage: {
      live: "Receive all identities until cancelled",
      old: "Recieve all old identities"
    },
    defaults: {
      live: false,
      old: true
    },
    run: (opts) => {
      opts.old = opts.old === "true" || opts.old === true ? true : false
      opts.live = opts.live === "true" || opts.live === true ? true : false
      opts.seqs = false
      opts.sync = false
      if (db.closed) return _.error(cb(Error('cannot call: api.identities.ls, flumedb instance is closed')))
      return db.stream(opts)
    }
  })

  const ls = {}
  const sync = () => {
    return _.asyncMap((item, cb) => {
      if (db.closed) return cb(Error('cannot call: api.identities.remove, flumedb instance is closed'))
   
      db.view.get((err, identities) => {
        if (err) return cb(null, item)
        const identity = identities ? identities[identities.id] : undefined
        if (db.closed) return cb(Error('cannot: sync groups, flumedb instance is closed'))
   
        if ((identity && identity.ts < item.ts) || !identity) return db.append(item, () => cb(null, item));
        return cb(null, item)
      })
    })
  }

  _(api.events(), api.events.on({
    closer: (e) => {
      try {
        if (!(e.peer.identities && e.peer.identities.ls)) return;
        if (!ls[e.id]) {
          const done = () => {
            if (ls[e.id]) {
              ls[e.id].abort(true)
              delete ls[e.id]

              api.log.info('Stop listening to live identities changes from', e.peerID, "on", api.id)
            }
          }

          ls[e.id] = Abortable(done)
          api.log.info('Listen to live identity changes from', e.peerID, "on", api.id)
          _(e.peer.identities.ls({ old: true, live: true }), ls[e.id], sync(), _.onEnd(done))
        }
      }
      catch (err) {
        api.log.error("Identities api error", err.message || err)
      }

      api.log.debug('peer is closer', e.peerID)
    },
    notcloser: (e) => {

      if (ls[e.id]) {
        ls[e.id].abort(true)
        delete ls[e.id]
      }

      api.log.debug('peer is not closer', e.peerID)
    },
    replicate: (e) => {
      try {
        api.log('Replicating identities from peer', e.peerID)

        _(e.peer.identities.ls({ old: true, live: false }), sync(), _.onEnd((err) => {
          if (err) api.log.error("Identities api replication error", err.message || err)
        }))

        api.log('Identities from', e.peerID, 'replicated')
      }
      catch (err) {
        api.log.error("Identities api replication error", err.message || err)
      }
    },
    end: () => { }
  }))

  const events = _.events()

  db.view.ready(() => { events.emit({ type: "ready" }) })

  const end = events.end
  events.end = (err) => {
    db.close(() => { })
    end(err)
  }

  return events
}