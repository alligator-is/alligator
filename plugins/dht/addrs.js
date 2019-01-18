const { api, _, Action } = require("../..")
const path = require('path')
const traverse = require("traverse")
const mkdirp = require('mkdirp')
const Abortable = require('pull-abortable')
const pl = require('pull-level')
const leveldown = require('leveldown')
const encode = require('encoding-down')
const util = require('icebreaker-network/lib/util')
const Intervals = require("../../lib/intervals")

module.exports = () => {
  const dir = path.join(api.config.path, "addrs")
  try { mkdirp.sync(dir) }
  catch (err) { }

  const db = require('levelup')(encode(leveldown(dir), { valueEncoding: 'json' }))

  const timers = new Intervals()

  const add = (data, cb) => {
    db.get(data.key, (err, d) => {
      if (err) return db.put(data.key, data, cb)
      if (d.ts < data.ts) return db.put(data.key, data, cb)
      cb(null, d)
    })
  }

  const ls = {}

  const write = () => {
    return _.asyncMap((item, cb) => {
      add(item, (err) => { cb(err, item) })
    })
  }

  api.addrs = api.actions.addrs = Action({
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
    run: (opts) => {
      opts.old = opts.old === "true" || opts.old === true ? true : false
      opts.live = opts.live === "true" || opts.live === true ? true : false
      opts.keys = false
      opts.sync = false
      const ts = Date.now()-api.config.connectionTimeout
      return _(pl.read(db, opts),_.filter((item)=>{ 
        if(item && item.ts<ts)setImmediate(()=>{
          db.del(item.key)
        })
        return item  && item.ts>ts
      }))
    }
  })

  const addAddrs = (e,map) => {
    const ts = Date.now()
    if (e.addrs && e.peer)
      for (let addr of e.addrs) {
        traverse(e.peer).forEach(function () {
          if (_.isFunction(this.node)) {
            let value ={ key: addr + "/" + this.path.join("/"), ts: ts,action:this.path.join(".") }
            Object.assign(value,this.node)
            if(map) value =map(value)
            add(value, (err) => {
              if (err) return api.log.error(err)
            })
          }
        })
      }
  }

  const addClient = (e) => {          
    _(pl.read(db,{old:true,sync:false,live:false,keys:false}),
    _.filter(function(item){
      return item.key.indexOf("://"+api.id+"@")!=-1  && item.key.endsWith(api.config.appKey+"/protoNames") && !item.gw
    }),
    _.collect((err,addrs)=>{
      let maxts 
      addrs.forEach((item)=>{ maxts = Math.max(maxts||0,item.ts) })
      addrs=addrs.filter((addr)=>{ return addr.ts === maxts })
      addrs = addrs.map((addr)=>{ return addr.key.replace("/protoNames","") })
      addAddrs({addrs:[e.remoteAddress],peer:e.peer},(data)=>{
        data.gw = addrs
        return data
      })
    }))
  }

  _(api.events(), api.events.on({
    connection:(e)=>{
      if(!e.peer.protoNames && e.remoteAddress!=null && e.peer){
          timers.start(e.id, ()=>addClient(e), api.config.pingInterval)
          addClient(e)
      }
    },
    closer: (e) => {
      try {
        addAddrs(e)
        timers.start(e.id,()=>addAddrs(e),api.config.pingInterval)
        if (!e.peer.addrs) return
        if (!ls[e.id]) {
          const done = () => {
            if (ls[e.id]) {
              ls[e.id].abort(true)
              delete ls[e.id]
              api.log.info('Stop listening to live address changes from', e.peerID, "on", api.id)
            }
          }

          ls[e.id] = Abortable(done)

          api.log.info('Listen to live address changes from', e.peerID, "on", api.id)
          _(e.peer.addrs({ old: true, live: true }), ls[e.id], write(), _.onEnd(done))
        }
      }
      catch (err) {
        api.log.error("Addresses api error", err.message || err)
      }

    },
    notcloser: (e) => {
      addAddrs(e)
      timers.stop(e.id)
      if (ls[e.id]) {
        ls[e.id].abort(true)
        delete ls[e.id]
      }
    },
    replicate: (e) => {
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
    disconnection:(e)=>{
      timers.stop(e.id)
    },
    end: (e) => {
 
    }

  }))

  const events = _.events()
  const end = events.end
  events.end=()=>{
    timers.stopAll()
    db.close(function(){
      end()
    })
  }
  events.emit({type:"ready"})
  return events
  
}
