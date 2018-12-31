const { api, _, Action } = require("../../")
const path = require('path')
const dir = path.join(api.config.path, "friends")
const Flume = require('flumedb')
const OffsetLog = require('flumelog-offset')
const codec = require('flumecodec')
const Reduce = require('flumeview-reduce')
const Abortable = require('pull-abortable')

const db = Flume(OffsetLog(dir, { codec: codec.json })).use('view', Reduce(1, function (acc, item) {
    if (acc == null) acc = {}
    if (item.id) {
        if (acc[item.id] && item.ts > acc[item.id].ts) acc[item.id] = item
        if (!acc[item.id]) acc[item.id] = item
        //if (acc[item.id].delete === true) delete acc[item.id]
    }
    return acc
}))

api.friends = {}
api.actions.friends = {}

api.friends.add = api.actions.friends.add = Action({
    type: "async",
    input: "string",
    desc: "Adds a friend",
    run: (key, cb) => {
        if (db.closed) return cb(Error('cannot call: api.friends.add, flumedb instance is closed'))
        const item = {
            id: key,
            ts: Date.now()
        }
        db.append(item, (err, sec) => {
            if (db.closed) return cb(Error('cannot call: api.friends.add, flumedb instance is closed'))
            if (err) return cb(err)
            db.view.get((err, res) => {
                if (err) return cb(err)
                cb(null, res && res[key] ? res[key] : item)
            })
        })
    }
})

api.friends.remove = api.actions.friends.remove = Action({
    type: "async",
    input: "string",
    run: (key, cb) => {
        db.append({
            id: key,
            ts: Date.now(),
            delete: true
        }, (err, sec) => {
            if (err) return cb(err)
            db.view.get(function (err, res) {
                if (err) return cb(err)
                cb(null, res[key] ? true : false)
            })
        })
    }
})

api.friends.isFriend = function (id, cb) {
    if (db.closed) return cb(Error('cannot call: api.friends.isFriend, flumedb instance is closed'))

    db.view.get((err, friends) => {
        if (err) return cb(err)
        if (!friends) return cb(null, false)
        if (id && friends[id] && friends[id].delete === true) return cb(null, false)
        cb(null, id && friends[id] ? true : false)
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
        opts.old = opts.old === "true" || opts.old === true ? true : false
        opts.live = opts.live === "true" || opts.live === true ? true : false
        opts.seqs = false
        opts.sync = false
        if (db.closed) return _.error(cb(Error('cannot call: api.friends.ls, flumedb instance is closed')))
        return db.stream(opts)
    }
})

const ls = {}
const sync = () => {
    return _.asyncMap((item, cb) => {
        db.view.get((err, friends) => {
            if (err) return cb(null, item)
            const friend = friends[item.id]
            if ((friend && friend.ts < item.ts) || !friend) return db.append(item, () => cb(null, item));
            return cb(null, item)
        })
    })
}

_(api.events(), api.events.on({
    closer: (e) => {
        try {
            if (!(e.peer.friends && e.peer.friends.ls)) return;
            if (!ls[e.id]) {
                const done = () => {
                    if (ls[e.id]) {
                        ls[e.id].abort(true)
                        delete ls[e.id]

                        api.log.info('Stop listening to live friend changes from', e.peerID, "on", api.id)
                    }
                }

                ls[e.id] = Abortable(done)
                api.log.info('Listen to live friend changes from', e.peerID, "on", api.id)
                _(e.peer.friends.ls({ old: true, live: true }), ls[e.id], sync(), _.onEnd(done))
            }
        }
        catch (err) {
            api.log.error("Friend api error", err.message || err)
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
            api.log('Replicating friends from peer', e.peerID)

            _(e.peer.friends.ls({ old: true, live: false }), sync(), _.onEnd((err) => {
                if (err) api.log.error("Friend api replication error", err.message || err)
            }))

            api.log('Friends from', e.peerID, 'replicated')
        }
        catch (err) {
            api.log.error("Friend api replication error", err.message || err)
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

api.config.authenticate = function (id, cb) {

    if (this.protocol && this.protocol.indexOf("+unix") !== -1) {
        return db.view.get((err, item) => {
            if (err) return api.friends.add(id, () => { return cb(null, "friend") });
            if (item && item[id] && item[id].delete !== true) return cb(null, "friend")

            return api.friends.add(id, () => {
                return cb(null, "friend")
            })
        })
    }

    api.friends.isFriend(id, (err, friend) => {
        if (err) return cb(err)
        if (friend) return cb(null, "friend")
        return cb("access denied for " + id);
    })
}

module.exports = events