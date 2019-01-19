const { api, _, Action } = require("../../")
const Remote = require("icebreaker-rpc/lib/remote.js")
const utils = require("icebreaker-network/lib/util.js")
const flat = require("flat")
const Util = require('muxrpc/util')
const rr = require('rr')
const Defer = require('pull-defer')
const distance = require('k-bucket').distance
const unset = require('unset-value');

module.exports = () => {

  let spec = {}
  let lb = {}
  let robin = {}

  api.actions.call = {
   
    promise: Action({
      type: "promise",
      input: ["string", "string", "array"],
      desc: "This run a promise action on peerID",
      run: async function (peerID, path, args) {
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
      run: (peerID, path, args) => {
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
    }),
    duplex: Action({
      type: "source",
      input: ["string", "string", "array"],
      desc: "This run a duplex stream on peerID",
      run: (peerID, path, args) => {
        const error = (err) => {
          return {
            source: _.error(err),
            sink: (read) => {
              read(err || true, (_err) => { })
            }
          }
        }

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
    }),
    sink: Action({
      type: "sink",
      input: ["string", "string", "array"],
      desc: "This run a sink stream on peerID",
      run: (peerID, path, args, cb) => {
        args.push(cb)

        const error = (err) => {
          return (read) => {
            read(err || true, (_err) => { cb(err || _err) })
          }
        }

        for (let k in api.connections) {
          let c = api.connections[k]
          if (c.peerID === peerID && c.peer) {
            const f = flat.flatten(c.peer)
            if (!f[path]) return error(new Error("Action " + path + " not found on " + peerID))
            if (f[path].type !== "sink") return error(new Error("Action " + path + " type is not a sink on " + peerID))
            return f[path](...args)
          }
        }

        return error(new Error("No Peer with id" + peerID + " found on " + api.id))
      }
    })

  }

  api.actions.call.async= api.actions.call.sync = Action({
    type: "async",
    input: ["string", "string", "array"],
    desc: "This run a async or sync action on peerID",
    run: (peerID, path, args, cb) => {
      for (let k in api.connections) {
        let c = api.connections[k]
        if (c.peerID === peerID && c.peer) {
          const f = flat.flatten(c.peer)
          if (!f[path]) return cb(new Error("Action " + path + " not found on " + peerID))
          if (f[path].type !== "sync" && f[path].type !== "async") return cb(new Error("Action " + path + " type is not sync or async on " + peerID))
          return f[path](...args)
        }
      }

      return cb(new Error("No Peer with id" + peerID + " found on " + api.id))
    }
  })


  function error(type, error, cb, defer) {
    if (type === "promise") {
      if (defer) return defer.reject(error)

      return new Promise((resolve, reject) => {
        reject(error)
      });
    }

    if (!cb) cb = _.isFunction(cb) ? cb : (err) => {
      if (type == "duplex") return
      if (err) throw new Error(err || 'callback not provided')
    }
    if (defer) defer.resolve(Util.errorAsStreamOrCb(type, error, cb))

    return Util.errorAsStreamOrCb(type, error, cb)
  }


  function remoteCall(type, path, args) {

    const cb = _.isFunction(args[args.length - 1]) ? args[args.length - 1] : null
    if (cb) args.pop()

    try {
      if (!spec[path]) return error(type, new Error("function " + path + " unarivable"), cb)
      const addrs = spec[path]
      const keys = Object.keys(addrs)
      if (keys.length === 0) return error(type, new Error("No address found for action " + path), cb)
      const key = rr(keys, robin[path] || 0)
      const address = Object.keys(spec[path][key])
      if (address.length === 0) return error(type, new Error("No address found for action " + path), cb)

      robin[path] = keys._rr

      const connect = (cb, resolve, reject) => {
        let defer
        if (type == "source" || type == "sink" || type == "duplex") defer = Defer[type]()
        if (type == "promise") defer = { reject: reject, resolve: resolve }
        api.connect(address, (err, e) => {
          if (err) return error(type, err, cb, defer)
          cb(e, cb, defer)
        })
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
        connect((e, cb, defer) => {
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

  _(
    api.addrs({live:true,old:true}),
    _.drain((data) => {
      const url = utils.parseUrl(data.key)

      if (!spec[data.action]) spec[data.action] = {}
      if (!spec[data.action][url.auth]) spec[data.action][url.auth] = {}

      let address = data.key.replace("/" + data.action.replace(".", "/"), "").replace("/" + api.config.appKey, "")
      const apiId = api.config.keys.publicKey

      if (data.gw != null) {
        const gw = data.gw.sort(function (a, b) {
          const aId = utils.parseUrl(a).auth
          const bId = utils.parseUrl(b).auth
          distance(utils.decode(aId, api.config.encoding), apiId) - distance(utils.decode(bId, api.config.encoding), apiId)
        })

        data.gw.forEach(addr => {
          addr = addr.replace("/" + api.config.appKey, "")
          if (spec[data.action][url.auth][addr] == null || spec[data.action][url.auth][addr] < data.ts)
            spec[data.action][url.auth][addr] = data.ts
        })
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
      delete data.gw
      action[data.action] = data

      Object.assign(lb, Remote(flat.unflatten(action), remoteCall))
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
    }, () => { 


    }))

  api.lb = api.actions.lb = lb
}