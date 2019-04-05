const { api, _, Action } = require("../../")
const util = require('icebreaker-network/lib/util')

module.exports = () => {

  const groupId = "cjtvt7ch50000e8uj3gsn0fjv"

  api.groups.put({ id: groupId, name: "friends", allow: "*" }, (err) => {
    if (err) {
      api.log.error(err)
      process.exit(1)
    }
  })


  api.friends = {}
  api.actions.friends = {}

  api.friends.put = api.actions.friends.put = Action({
    type: "async",
    input: "string",
    desc: "Put a friend",
    run: (key, cb) => {
      try {
        util.decode(key, api.config.encoding)
      } catch (err) {
        return cb(err)
      }
      api.identities.get(key, (err, identity) => {
        if (err) return api.identities.put({ id: key, groups: groupId }, cb);
        if (identity && identity.groups && !Array.isArray(identity.groups)) identity.groups = []
        if (identity.groups.indexOf(groupId) === -1) {
          identity.groups.put(groupId)
          return api.identities.put(identity, cb);
        }

        return cb(null, identity)
      })

    }
  })

  api.friends.remove = api.actions.friends.remove = Action({
    type: "async",
    input: "string",
    desc: "Remove a friend by id",
    run: (key, cb) => {
      api.identities.remove(key, cb)
    }
  })

  api.friends.isFriend = function (id, cb) {
    api.identities.get(id, (err, identity) => {
      if (err) return cb(err, false)
      if (!identity.groups || !Array.isArray(identity.groups)) return cb(null, false)
      if (identity.groups.indexOf(groupId) !== -1) return cb(err, true)
      return cb(err, false)
    })
  }

  api.friends.ls = api.actions.friends.ls = Action({
    type: "source",
    input: { live: "boolean|string", old: "boolean|string" },
    desc: "Returns all friends",
    usage: {
      live: "Receive all friends until cancelled",
      old: "Recive all old friends"
    },
    defaults: {
      live: false,
      old: true
    },
    run: (opts) => {
      return _(api.identities.ls(opts), _.filterNot((item) => item && Array.isArray(item.groups) && item.groups.indexOf(groupId) === -1
      ))
    }
  })
 
  api.config.authenticate = function (id, cb) {
    if(!id)return cb("access denied for " + id);

   if (this.protocol && this.protocol.indexOf("+unix") !== -1){
      return api.friends.isFriend(id,(err,found)=>{
          if(!found)return api.friends.put(id, (err) => cb(null, true)) 
          return cb(null,true)
      })
    }
      return api.identities.get(id, (err, identity) => {
        if (err) return cb(err, false);  
        if (!(identity.groups && Array.isArray(identity.groups) && identity.groups.length > 0)) return cb("access denied for " + id);
        return cb(null, true);
      })
    
  }

  api.config.perms = function (id, cb) {
    api.identities.get(id, (err, identity) => {
      if (err) return cb(err);
      if (!(identity.groups && Array.isArray(identity.groups))) return cb("access denied for " + id);

      if (identity.groups.indexOf(groupId) !== -1) return cb(null, "*")

      _(identity.groups, _.asyncMap((group, cb) => api.groups.get(group, (err, data) => cb(err, data.allow || []))
      ), _.flatten(), _.unique(), _.collect((err, data) => {
        if (err) return cb(err)
        if (data && data.length > 0) return data.allow.indexOf("*") !== -1 ? cb(null, null) : cb(null, data)
        return cb("access denied for " + id);
      }))
    })
  }
  
}