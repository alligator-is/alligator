const { api, _, Action } = require("../..")
const path = require('path')
const traverse = require("traverse")
const mkdirp = require('mkdirp')
const Abortable = require('pull-abortable')
const pl = require('pull-level')
const leveldown = require('leveldown')
const encode = require('encoding-down')
const Intervals = require("../../lib/intervals")
const util = require('icebreaker-network/lib/util')

const filter = require('pull-async-filter')

module.exports = () => {
  const dir = path.join(api.config.path, "addrs")
  try { mkdirp.sync(dir) }
  catch (err) { }

  const db = require('levelup')(encode(leveldown(dir), { valueEncoding: 'json' }))

  const timers = new Intervals()

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
      return  cb(null, item)
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
    run: function(opts) {

      opts.old = opts.old === "true" || opts.old === true ? true : false
      opts.live = opts.live === "true" || opts.live === true ? true : false
      opts.keys = true
      opts.sync = false
      
      const peerID = this.id
      
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
      }),_.map((item)=>Object.assign({},item.value)),_.asyncMap((item,cb)=>{
        if(!peerID) return     cb(null,item)
        
        api.friends.isFriend(peerID,function(err,isFriend){
          if(err) return cb(null,undefined);
          if(isFriend) return  cb(null,item)

        api.identities.get(peerID,(err,identity)=>{
          if(err) return cb(null,undefined);
        
          const  u = util.parseUrl(item.key)
          api.identities.get(u.auth,(err,id)=>{
            if(err) return cb(null,undefined)
            for(let g of identity.groups){
              if(id.groups.indexOf(g) !== -1)
              {
                api.groups.get(g,function(err,group){
                  if(err) return cb(null,undefined)
                  if(group.allow.indexOf("*")!==-1||group.allow.indexOf(u.pathname.split("/").slice(2).join(".") !==-1))
                  return cb(null,item)           
                  return cb(null,undefined)

                })

              }
            }
            return cb(null,undefined);
          })
    
        });
      })

      }),_.filter()
      )
    }
  })

  const addAddrs = (e,map) => {
    const ts = Date.now()
    if (e.addrs && e.peer)
    e.addrs.forEach((addr,index)=> {
      traverse(e.peer).forEach(function () {
        if (_.isFunction(this.node)) {
          let key = addr + "/" + this.path.join("/")
          if(e.gw) key = key + "?gw="+encodeURIComponent(e.gw[index])        
          let value = Object.assign({ key: key, ts: ts,action:this.path.join(".") },this.node)
          if(value.ts)
            add(value, (err) => {
              if (err) return api.log.error(err)
            })
          }
        })
      })
  }
  
  const addClient = (e) => {
    _(api.addrs({old:true,live:false}),
    filter((item,cb) => {
      if(item.key.indexOf("://"+api.id+"@") === -1) return cb(null,true)
        const u =util.parseUrl(item.key)   
        const path = u.pathname
        if(path && !path.startsWith("/"+api.config.appKey+"/protoNames")) return cb(null,true)
        api.friends.isFriend(u.auth, (err,isFriend)=> {
          return cb(null,!(isFriend && path && path.startsWith("/"+api.config.appKey+"/protoNames") && !u.query.gw))
        })
      }
      ),
    _.collect(function(err,addrs){
      if(err) return
      if(!addrs) return
      if(addrs.length <= 0) return;
      let maxts 
      addrs.forEach((item)=>{ maxts = Math.max(maxts||0,item.ts) })
      addrs=addrs.filter((addr)=>{ return addr.ts === maxts })
      addrs = addrs.map((addr)=>{
        return addr.key.replace("/protoNames","") 
      })
      
      addAddrs({addrs:addrs.map((addr)=>e.remoteAddress),gw:addrs,peer:e.peer})
    }))
  }

  _(api.events(), api.events.on({
    connection:(e)=>{
      if(!e.peerID) return;
      if(e.remoteAddress)
      api.friends.isFriend(e.peerID,(err,isFriend)=>{
        if(!isFriend &&  e.peer && e.peerID !== api.id){
          timers.start(e.id, ()=>addClient(e), api.config.pingInterval)
           addClient(e)
         return
        }

        if(isFriend && e.peer && !e.peer.protoNames && e.peerID !== api.id)
        {
              timers.start(e.id, ()=>addClient(e), api.config.pingInterval)
              addClient(e)  
              return

        }


        if(isFriend && e.peer && e.peer.protoNames && e.peerID !== api.id)
        {
            e.peer.protoNames(function(err,protos){
              if(err)return;
              if(protos.length<=0){

                timers.start(e.id, ()=>addClient(e), api.config.pingInterval)
                addClient(e)  
                
              }

            })
        }
      })
      
    },
    closer: (e) => {
      try {
        if(e.address){
          addAddrs(e)
          timers.start(e.id,()=>addAddrs(e),api.config.pingInterval)
        }
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
          _(e.peer.addrs({ old: false, live: true }), ls[e.id], write(), _.onEnd(done))
        }
      }
      catch (err) {
        api.log.error("Addresses api error", err.message || err)
      }

    },
    notcloser: (e) => {
      if(!e.remoteAddress)addAddrs(e)
        
      timers.stop(e.id)
      if (ls[e.id]) {
        ls[e.id].abort(true)
        delete ls[e.id]
      }
    },
    replicate: (e) => {
      if(!e.peerID) return;
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
      if(!e.peerID) return;
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
  
  db.once("ready",function(){
    events.emit({type:"ready"})
  })

  return events
  
}
