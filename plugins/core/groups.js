const { api, _, Action } = require("../../")
const path = require('path')
const dir = path.join(api.config.path, "groups","data")
const Flume = require('flumedb')
const OffsetLog = require('flumelog-offset')
const codec = require('flumecodec')
const Reduce = require('flumeview-reduce')
const Abortable = require('pull-abortable')
const cuid = require('cuid');

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

  api.groups = {}
  api.actions.groups = {}
  api.groups.put = api.actions.groups.put = Action({
    type: "async",
    input: {id:"string?",name:"string",allow:"array|string?"},
    desc: "adds or updates the group" ,
    run: (group, cb) => {
      if (db.closed) return cb(Error('cannot call: api.groups.put, flumedb instance is closed'))
      db.view.get((err, groups) => {
        if (err) return cb(err)
        if(!group.id)group.id = cuid() 
         if(_.isString(group.allow))group.allow = [group.allow] 
        if(groups){
          if(!group.id) for(var i in groups)if(groups[i].name === item.name)group.id=i
          if(!group.allow && groups[group.id] && groups[group.id].allow) group.allow = groups[group.id].allow
          
          if(groups[group.id] && groups[group.id].name == group.name ){
            const obj = {}
            Object.assign(obj,groups[group.id])
            delete obj.ts
            delete group.ts
            if(JSON.stringify(obj)  === JSON.stringify(group)) return cb(null, groups[group.id])
          }
        }
        group.ts = Date.now()
        group.delete=false;
        db.append(group, (err, sec) => {
          if (db.closed) return cb(Error("cannot call: api.groups.put, flumedb instance is closed"))
          if (err) return cb(err)
          db.view.get((err, res) => {
            if (err) return cb(err)
            cb(null, res && res[group.id] ? res[group.id] : group)
          })
        })
      })
    }
  })

  api.groups.remove = api.actions.groups.remove = Action({
    type: "async",
    input: "string",
    desc: "remove the group by id" ,
    run: (id, cb) => {
      if (db.closed) return cb(Error("cannot call: api.groups.remove, flumedb instance is closed"))
        db.view.get(function(err,groups){
          if(err) cb(err) 
        if(!groups[id]) return cb(null,true)
        
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

  api.groups.get = api.actions.groups.get = Action({
    type: "async",
    input: "string",
    desc: "gets the group by id" ,
    run: (id, cb) => {
      if (db.closed) return cb(Error("cannot call: api.groups.get, flumedb instance is closed"))
         
      db.view.get(function(err,groups){
        if(err) return cb(err)
        if(!groups[id]) return cb(new Error("Identity " + id +" not found!"))
        cb(null,groups[id])
      })
    }
  })


  api.groups.ls = api.actions.groups.ls = Action({
    type: "source",
    input: { live: "boolean|string", old: "boolean|string" },
    desc: "Returns all groups",
    usage: {
      live: "Receive all groups until cancelled",
      old: "Recieve all old groups"
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
      if (db.closed) return _.error(cb(Error('cannot call: api.groups.ls, flumedb instance is closed')))
      return db.stream(opts)
    }
  })

  const ls = {}
  const sync = () => {
    return _.asyncMap((item, cb) => {
      try{
        if (db.closed) return cb(Error('cannot: sync groups, flumedb instance is closed'))
   
        db.view.get((err, groups) => {
          if (err) return cb(null, item)
          const group = groups ? groups[item.id] : undefined
          if (db.closed) return cb(Error('cannot: sync groups, flumedb instance is closed'))
          if ((group && group.ts < item.ts) || !group) return db.append(item, () => cb(null, item));
          return cb(null, item)
        })
      }
      catch(err){
        if(err) api.log.error(err)
        return cb(null,item)
      }
    })
  }

  _(api.events(), api.events.on({
    closer: (e) => {
      try {
        if (!(e.peer.groups && e.peer.groups.ls)) return;
        if (!ls[e.id]) {
          const done = () => {
            if (ls[e.id]) {
              ls[e.id].abort(true)
              delete ls[e.id]

              api.log.info('Stop listening to live group changes from', e.peerID, "on", api.id)
            }
          }

          ls[e.id] = Abortable(done)
          api.log.info('Listen to live group changes from', e.peerID, "on", api.id)
          _(e.peer.groups.ls({ old: true, live: true }), ls[e.id], sync(), _.onEnd(done))
        }
      }
      catch (err) {
        api.log.error("Groups api error", err.message || err)
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
        api.log('Replicating groups from peer', e.peerID)

        _(e.peer.groups.ls({ old: true, live: false }), sync(), _.onEnd((err) => {
          if (err) api.log.error("Group api replication error", err.message || err)
        }))

        api.log('Group from', e.peerID, 'replicated')
      }
      catch (err) {
        api.log.error("Group api replication error", err.message || err)
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