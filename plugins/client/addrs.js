const { api, _, Action } = require("../..")
const path = require('path')
const mkdirp = require('mkdirp')
const Abortable = require('pull-abortable')
const pl = require('pull-level')
const leveldown = require('leveldown')
const encode = require('encoding-down')

module.exports = () => {
  const dir = path.join(api.config.path, "faddrs")
  try { mkdirp.sync(dir) }
  catch (err) { }

  const db = require('levelup')(encode(leveldown(dir), { valueEncoding: 'json' }))

  const add = (data, cb) =>{
    const r = Object.assign({},data)
    return db.get(r.key, (err, d) => {
    if(err)return db.put(r.key, r, (err)=> cb(err,r) )
      if(d.ts && data.ts>d.ts) return db.put(r.key, r, (err)=>cb(err,r))
      return      cb(null, d)
    })
  }

  const ls = {}

  const write =  () => {
    return _.asyncMap((item, cb) => {
      if(item && item.ts && item.key)
      add(item, (err) => cb(err, item) )
      return  cb(null, item||null)
    })
  }
  
  api.addrs = api.actions.addrs =Action({
    type: "source",
    input: { live: "boolean|string", old: "boolean|string" },
    desc: "Returns all known addresses",
    usage: {
      live: "Receive all addresses until cancelled",
      old: "Recive all old addresses"
    },
    defaults: {
      live: false,
      old: true
    },
    run: function(opts) {

      opts.old = opts.old === "true" || opts.old === true ? true : false
      opts.live = opts.live === "true" || opts.live === true ? true : false
      opts.keys = true
      opts.sync = false
      
      return _(pl.read(db, opts),_.filter((item)=>{
    
        if(!item)return false
        if(item.type!=="put" && item.type)return false
        if(!item.value)return false
        if(!item.value.ts){
          db.del(item.key,function(err){})
          return false
        }
        const ts = Date.now() - api.config.connectionTimeout
        if(item.value.ts<ts == true){
            db.del(item.key,function(err){})
          return false
        }
        delete item.type
        return item.value.ts>ts
      }),_.map((item)=>Object.assign({},item.value)),_.filter()
      )
    }
  })

  _(api.events(), api.events.on({
    closer: (e) => {
   
      try {
        if (!e.peer.addrs) return
        if (!ls[e.id]) {
          const done = (err) => {
            if (ls[e.id]) {
              ls[e.id].abort(true)
              delete ls[e.id]
              api.log.info('Stop listening to live address changes from', e.peerID, "on", api.id)
            }
          }

          ls[e.id] = Abortable(done)
          api.log.info('Listen to live address changes from', e.peerID, "on", api.id)
          
          _(e.peer.addrs({ old: false, live: true }), ls[e.id], write(), _.onEnd(done))
        
        }
      }
      catch (err) {
        api.log.error("Addresses api error", err.message || err)
      }

    },
    notcloser: (e) => {
    
      if (ls[e.id]) {
        ls[e.id].abort(true)
        delete ls[e.id]
      }
    },
    replicate: (e) => {
    
      if(!e.peerID) return;
      if(!e.peer.addrs) return
      try {
        api.log('Replicating addresses from peer', e.peerID)

        _(e.peer.addrs({ old: true, live: false }), write(), _.onEnd((err) => {
          if (err) api.log.error("Addresses replication error", err.message || err)
        }))

        api.log('Addresses from', e.peerID, 'replicated')
      }
      catch (err) {
        api.log.error("Addresses replication error", err.message || err)
      }
    },
 
    end: (e) => {
 
    }

  }))

  const events = _.events()
  const end = events.end
  events.end=()=>{
    db.close(function(){
      end()
    })
  }
  
  db.once("ready",function(){
    events.emit({type:"ready"})
  })

  return events
  
}
