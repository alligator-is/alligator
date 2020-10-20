
const Remote = require("icebreaker-rpc/lib/remote.js")
const utils = require("icebreaker-network/lib/util.js")
const flat = require("flat")
const Util = require('muxrpc/util')
const rr = require('rr')
const Defer = require('pull-defer')
const distance = require('k-bucket').distance
const unset = require('unset-value');
const assign = require('assign-deep');
const { _ } = require("../")

module.exports=function lb(api,cb) {
    let spec = {}
    let lb = {}
    const robin = {}


    function error(type, err, cb, defer) {
        if (type === "promise") {
          if (defer) return defer.reject(err)
    
          return new Promise((resolve, reject) => {
            reject(err)
          });
     
        }
        
        if (!cb) cb = _.isFunction(cb) ? cb : (err) => {
          if (type == "source" || type == "sink" || type == "duplex") return
          if (err) throw new Error(err || 'callback not provided')
        }
       
        if (defer){
            if(cb)cb(err)
            defer.resolve(Util.errorAsStream(type, err))
            return defer
        }
        if(type == "source" || type == "sink" || type == "duplex"){
          if(cb)cb(err) 
          return Util.errorAsStream(type, err,cb)
        }
        if(type == "async" ||"sync") return cb(err)
    
        return Util.errorAsStreamOrCb(type, err,cb)
       
      }
    
    
      function remoteCall(type, path, args) {
       path = _.isString(path)?path:Array.isArray(path)?path.join("."):path
        const cb = _.isFunction(args[args.length - 1]) ? args[args.length - 1] : null
        if (cb) args.pop()
        try {
          if (!spec[path]) return error(type, new Error("function " + path.join(".") + " unarivable"), cb)
          const addrs = spec[path]
          const keys = Object.keys(addrs)
          if (keys.length === 0) return error(type, new Error("No address found for action " + path), cb)
          keys._rr  = robin[path]=robin[path] || 0
          const key = rr(keys)
          robin[path] = keys._rr++
          const address = Object.keys(spec[path][key])
          if (address.length === 0) return error(type, new Error("No address found for action " + path), cb)

          const connect = (_cb, resolve, reject) => {
            let defer
            if (type == "source" || type == "sink" || type == "duplex") defer = Defer[type]()
            if (type == "promise") defer = { reject: reject, resolve: resolve }
            api.connect(address, (err, e) => {
              if (err) return error(type, err, cb, defer)
              _cb(e, cb, defer)
            })
            return defer
          }
          
          if (!address[0].includes("//" + key + "@")) {
    
            const subCall = (resolve, reject) => {
              return connect((e, cb, defer) => {
                try {
                  if (!(e.peer.call && e.peer.call[type]))
                    return error(type, new Error("Type " + type + " not supported on " + e.peerID), cb, defer)
                  if (defer) {
                    if (type == "sink")
                      return defer.resolve(e.peer.call[type](key, path, args, cb))
    
                    return defer.resolve(e.peer.call[type](key, path, args))
                  }
    
                  return e.peer.call[type](key, path, args, cb)
                }
                catch (err) {
                  if (err) return error(type, err, cb, defer)
                }
                return defer
    
              }, resolve, reject)
            }
    
            if (type === "promise") return new Promise(subCall)
            return subCall()
          }
    
          const call = (resolve, reject) => {
              return  connect((e, cb, defer) => {
              const f = flat.flatten(e.peer)
              if (!f[path]) return error(type, new Error("Action " + path + " not found on " + e.peerID), cb, defer)
                if (defer) return defer.resolve(f[path](...args))            
                return f[path].call(null, ...args, cb) 
            }, resolve, reject)
          }
    
          if (type === "promise") return new Promise(call)
          return call()
        }
        catch (err) {
          return error(type, err, cb)
        }
      }
      const onDrain = (data) => {
        const url = utils.parseUrl(data.key)
        const url2 = utils.parseUrl(data.key)
        delete url2.pathname
        const address = url2.format()
   
        const apiId = api.config.keys.publicKey
        if (!spec[data.action]) spec[data.action] = {}
        if (!spec[data.action][url.auth]) spec[data.action][url.auth] = {}
        if (url.query.gw != null) { 
            const addr = url.query.gw.replace("/" + api.config.appKey, "")
            if (spec[data.action][url.auth][addr] == null || spec[data.action][url.auth][addr] < data.ts)
            spec[data.action][url.auth][addr] = data.ts
        }
        else if (spec[data.action][url.auth][address] == null || spec[data.action][url.auth][address] < data.ts)
        spec[data.action][url.auth][address] = data.ts
     
        let keys = Object.keys(spec[data.action])
        .sort((a, b) => distance(utils.decode(a, api.config.encoding), apiId) - distance(utils.decode(b, api.config.encoding), apiId))
  
        const sorted = {}
        for (let k of keys) sorted[k] = spec[data.action][k]
        spec[data.action] = sorted
        const action = {}
        delete data.ts
        delete data.key
        action[data.action] = data
        assign(lb, Remote(flat.unflatten(action), remoteCall))
        const f = flat.flatten(lb)
        const ts = Date.now() - api.config.connectionTimeout
        Object.keys(f).forEach((k) => {
            if (spec[k]) {
              Object.keys(spec[k]).forEach((k2) => {
                if (spec[k][k2]) {
                  Object.keys(spec[k][k2]).forEach((addr) => {
                    if (spec[k][k2][addr] < ts) {
                      delete spec[k][k2][addr]
                    }
                    if (Object.keys(spec[k][k2]).length === 0) delete spec[k][k2]
                    if (Object.keys(spec[k]).length === 0) {
                      delete spec[k]
                      delete robin[k]
                      unset(lb, k)
                    }
    
                  })
    
                }
              })
            }
          })

    }
   
    if(api.live==true)
    _(
      api.addrs({live:true,old:false}),
      _.drain(onDrain,()=>{})
    )
    
    _(
      api.addrs({live:false,old:true}),
      _.drain(onDrain,()=>{
        if(cb) return cb(lb)  
      })
    )
    
    return lb
}