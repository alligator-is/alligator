const { api, _, Action } = require("../..")
const flat = require("flat")
const promisify = require('util').promisify;

module.exports = () => {
 
function hasPerms(peerID,rPeerID,path,cb){

  api.friends.isFriend(peerID,(err,isFriend)=>{
    if(err) return cb(err,false)
    if(isFriend) return cb(null,true)
    api.identities.get(peerID,(err,identity)=>{
      if(err) return cb(err,false)
      if(identity.groups && idenitiy.groups.length >0){
        api.identities.get(rPeerID,function(err,rIdnetity){
          if(err) return cb(err,false)
        
          if(rIdnetity.groups && rIdnetity.groups.length >0){
            _(idnetity.groups,_.asycMap(function(g,cb){
              api.groups.get(g,(err,g2)=>{
                if(err) return (null,undefined)
                return cb(null,g2)
              })   
            }),_.filter(),_.filter(function(g){
                return g.allow.indexOf(path) ==-1 && rIdnetity.groups.indexOf(g) ==-1 
            }),_.collect(function(err,groups){
              if(Array.isArray(groups) && groups.length>0)   return cb(null,true)
         
              return cb(null,false)
            }))
            return   
          }
          cb(null,false)
      
        })
        return
      }
      cb(null,false)
    })
  })
}

  api.actions.call = {
   
    promise: Action({
      type: "promise",
      input: ["string", "string", "array"],
      desc: "This run a promise action on peerID",
      run: async function (peerID, path, args) {
        if(!this.id)throw new Error("No permission to call " + path + " from "  + api.id +" on " + peerID)
        const has =  await promisify(hasPerms)(this.id,peerID,path)
        if(!has) throw new Error("No permission to call " + path + " from "  + this.id +" on " + peerID)
    
        for (let k in api.connections) {
          let c = api.connections[k]
          if (c.peerID === peerID && c.peer) {
            const f = flat.flatten(c.peer)
            if (!f[path]) throw new Error("Action " + path + " not found on " + peerID)
            if (f[path].type !== "promise") throw new Error("Action " + path + " type is not a promise on " + peerID)
            return await f[path](...args)
          }
      
        }
        throw new Error("No Peer with id" + peerID + " found on " + api.id)
      }
    }),
    source: Action({
      type: "source",
      input: ["string", "string", "array"],
      desc: "This run a source stream on peerID",
      run: function(peerID, path, args)  {
        
        if(!this.id) return _.error(new Error("No permissions to call " + path + " from "  + api.id+" on " + peerID))

        let callSource = (peerID,path,args)=>{
          for (let k in api.connections) {
            let c = api.connections[k]
            if (c.peerID === peerID && c.peer) {
              const f = flat.flatten(c.peer)
              if (!f[path]) return _.error(new Error("Action " + path + " not found on " + peerID))
              if (f[path].type !== "source") return _.error(new Error("Action " + path + " type is not a source on " + peerID))
              return f[path](...args)
            }
          }
          return _.error(new Error("No Peer with id" + peerID + " found on " + api.id))
        }

        
        const deferred = defer.source();
        const self = this;
        hasPerms(this.id,peerID,path,function(err,has){
          if(has) return deferred.resolve(callSource(peerID,path,args))
          deferred.resolve(_.error(new Error("No permissions to call " + path + " from "  + self.id +" on " + peerID)))
        })

        return deferred
      }

    }),
    duplex: Action({
      type: "source",
      input: ["string", "string", "array"],
      desc: "This run a duplex stream on peerID",
      run: function(peerID, path, args)  {
        const error = (err) => {
          return {
            source: _.error(err),
            sink: (read) => {
              read(err || true, (_err) => { })
            }
          }
        }
        if(!this.id) return error(new Error("No permissions to call " + path + " from "  + api.id +" on " + peerID))

        const callDuplex = (peerID,path,args)=>{
          for (let k in api.connections) {
            let c = api.connections[k]
            if (c.peerID === peerID && c.peer) {
              const f = flat.flatten(c.peer)
              if (!f[path]) return error(new Error("Action " + path + " not found on " + peerID))
              if (f[path].type !== "source") return error(new Error("Action " + path + " type is not a source on " + peerID))
              return f[path](...args)
            }
          }
          return error(new Error("No Peer with id" + peerID + " found on " + api.id))  
        }
        
        const deferred = defer.duplex();
        const self = this;
        hasPerms(this.id,peerID,path,function(err,has){
          if(has) return deferred.resolve(callDuplex(peerID,path,args))
          deferred.resolve(error(new Error("No permissions to call " + path + " from "  + self.id +" on " + peerID)))
        })

        return deferred
      }
    }),
    sink: Action({
      type: "sink",
      input: ["string", "string", "array"],
      desc: "This run a sink stream on peerID",
      run: function(peerID, path, args, cb) {
        args.push(cb)

        const error = (err) => {
          return (read) => {
            read(err || true, (_err) => { cb(err || _err) })
          }
        }

        if(!this.id) return error(new Error("No permissions to call " + path + " from "  + api.id +" on " + peerID))

        const callSink = (peerID,path,args,cb)=>{   
        
        for (let k in api.connections) {
          let c = api.connections[k]
          if (c.peerID === peerID && c.peer) {
            const f = flat.flatten(c.peer)
            if (!f[path]) return error(new Error("Action " + path + " not found on " + peerID))
            if (f[path].type !== "sink") return error(new Error("Action " + path + " type is not a sink on " + peerID))
            return f[path](...args,cb)
          }
        }

        return error(new Error("No Peer with id" + peerID + " found on " + api.id))
      }


      const deferred = defer.sink();
      const self = this;
      hasPerms(this.id,peerID,path,function(err,has){
        if(has) return deferred.resolve(callSink(peerID,path,args,cb))
        deferred.resolve(error(new Error("No permissions to call " + path + " from "  + self.id +" on " + peerID)))
      })

      return deferred

      }
    })

  }

  api.actions.call.async= api.actions.call.sync = Action({
    type: "async",
    input: ["string", "string", "array"],
    desc: "This run a async or sync action on peerID",
    run: function(peerID, path, args, cb)  {
      if(!this.id) return cb(new Error("No permissions to call " + path + " from "  + self.id +" on " + peerID))
      const callAsync = (peerID,path,args,cb)=>{
      let found
      let foundPeer
      for (let k in api.connections) {
        let c = api.connections[k]
        if (c.peerID === peerID && c.peer) {
          const f = flat.flatten(c.peer)
          if(f[path])found = f[path]
      
          foundPeer=true
        }

      }

      
      if(!foundPeer) return cb(new Error("No Peer with id" + peerID + " found on " + api.id))
      if (!found) return cb(new Error("Action " + path + " not found on " + peerID))
      if (found.type !== "sync" && found.type !== "async") return cb(new Error("Action " + path + " type is not sync or async on " + peerID))
      
      return found(...args,cb)
   

      }

      const self = this;
      hasPerms(this.id,peerID,path,(err,has)=>{
        if(has) return callAsync(peerID,path,args,cb)
        cb(new Error("No permissions to call " + path + " from "  + self.id +" on " + peerID))
      })

    }
  })




}
