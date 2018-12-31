const {api,_,Action} = require("../..")
const path = require('path')
const traverse = require("traverse")
const mkdirp = require('mkdirp')
const Abortable = require('pull-abortable')
const pl = require('pull-level')
const leveldown = require('leveldown')
const encode = require('encoding-down')

const dir = path.join(api.config.path,  "addrs")
try{ mkdirp.sync(dir) }
catch(err){ }

const db = require('levelup')(encode(leveldown(dir),{valueEncoding: 'json' }))

const add=  (data, cb) => {
    db.get(data.key,(err,d)=>{
        if(err) return   db.put(data.key,data, cb)
        if(d.ts<data.ts)return db.put(data.key,data, cb)
        cb(null,d)
    })
}

const ls = {}

const write = ()=>{
    return _.asyncMap((item,cb)=>{ 
        add(item,(err)=>{ cb(err,item) })
    })
}

api.addrs = api.actions.addrs = Action({
    type: "source",
    input: { live: "boolean|string" ,old:"boolean|string"},
    desc: "Returns all known addresses",
    usage: {
        live: "Receive all addresses until cancelled",
        old:"Recive all old addresses"
    },
    defaults: {
        live: false,
        old:true
    },
    run: (opts)=>{
        opts.old=opts.old==="true"||opts.old===true?true:false
        opts.live=opts.live==="true"||opts.live===true?true:false
        opts.keys=false
        opts.sync=false
        return pl.read(db,opts)
    }
})

const addAddrs =(e)=>{
    if(e.addrs  && e.peer)
    for(let addr of e.addrs){
        traverse(e.peer).forEach(function(){
            if(_.isFunction(this.node)){
                add({key:addr+"/"+this.path.join("/"),ts:Date.now()},(err)=>{
                    if(err) return api.log.error(err)
                })
            }
        })
    }
}

_(api.events(),api.events.on({
    closer:(e)=>{
        try{
            addAddrs(e)
            if(!e.peer.addrs)return
            if (!ls[e.id]) {
                const done = ()=>{
                  if (ls[e.id]){
                    ls[e.id].abort(true)
                    delete ls[e.id]
                    api.log.info('Stop listening to live address changes from', e.peerID,"on",api.id)
                  }
                }
        
              ls[e.id] = Abortable(done)
                
              api.log.info('Listen to live address changes from', e.peerID,"on",api.id)
              _(e.peer.addrs({ old:true, live: true}),ls[e.id],write(),_.onEnd(done))
            }
        }
        catch(err){
           api.log.error("Addresses api error",err.message||err)
        }

    },
    notcloser:(e)=>{
        addAddrs(e)
        if (ls[e.id]){
            ls[e.id].abort(true)
            delete ls[e.id]
        }
    },
    replicate:(e)=>{
        try{
            api.log('Replicating addresses from peer', e.peerID)

            _(e.peer.addrs({ old: true, live: false}),write(),_.onEnd((err)=>{
                if(err)api.log.error("Addresses replication error",err.message||err)
            }))

            api.log('Addresses from', e.peerID, 'replicated')     
        }
        catch(err){
            api.log.error("Addresses replication error",err.message||err)
        }
    },
    end:(e)=>{
        db.close()  
    }
    
}))
