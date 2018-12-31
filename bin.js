#!/usr/bin/env node
const { Action, _, api } = require('./')
const { Peer, Connect, Local } = require("icebreaker-rpc")
const mkdirp = require("mkdirp")
const path = require('path')
const os = require('os')
const CLI = require("./lib/cli")
const address = require('network-address')
const url = require('url')
const ms = require('ms')
const fs = require("fs")
const home = require('osenv').home
const test = api.config && api.config.test || null
const name = process.env.alligator_appname || test || 'alligator'
const appKey = process.env.alligator_appkey || test ? "test" : 'alligator@1.0.0'
const dir = path.dirname(fs.realpathSync(__filename))
const Timeout = require("./lib/timeout")

api.actions = Local()

api.config = api.config || {}
const configDir = api.config.path || path.join(home(), '.' + name)
mkdirp.sync(configDir);

const peerInfo = require('./lib/peerInfo.js').loadOrCreateSync(path.join(configDir, 'peerInfo'), { appKey: appKey })
api.id = JSON.parse(peerInfo.toJSON())["keys"]["publicKey"]

api.config.listen = api.config.listen || [
  'shs+tcp://[::]:4239'
]

if (address.ipv6() === "::1")
  api.config.listen = api.config.listen || [
    'shs+tcp://0.0.0.0:4239',
    'shs+ws://0.0.0.0:4238'
  ]

api.config.logLevel = api.config.logLevel || 7

api.config.path = configDir
if (!api.config.test) api.config = require('rc')(name, api.config)

Object.assign(api.config, peerInfo)

require("./lib/logger")

const connect = Connect.bind(null, "shs+tcp+unix://" + encodeURIComponent(api.id) + "@" + path.join("/", os.tmpdir(), name + ".sock"), null, peerInfo)

const events = _.events()
api.events = events.listen
api.events.on = require("icebreaker-network").on
api.events.map = require("icebreaker-network").map
api.events.asyncMap = require("icebreaker-network").asyncMap
api.events.paraMap = require("icebreaker-network").paraMap
api.events.combine = require("icebreaker-network").combine

let e

api.actions.start = Action({
  type: "async",
  desc: "Starts the server",
  usage: {
    target: "path, to your project directory",
  },
  input: {
    target: "string?",
    listen: "array?|string?",
    logLevel: "number",
    bootstrap: "array?|string?"
  },
  defaults: {
    listen: api.config.listen,
    logLevel: api.config.logLevel,
  },
  run: (opts, cb) => {
    if (_.isFunction(opts)) {
      cb = cb || opts
      opts = {}
    }

    if (_.isString(opts.listen)) opts.listen = [opts.listen]

    api.config.listen = opts.listen
    api.config.logLevel = opts.logLevel

    if (e) {
      api.log.error("Can't start because " + name + " is already running  – shut it down first!")
      process.exitCode = 1
      return setTimeout(e.end, 200)
    }

    api.config.plugins = api.config.plugins || []

    if (opts.target) {
      const main = require(path.join(path.resolve(opts.target), "/package.json")).main
      api.config.plugins.push(path.join(path.resolve(opts.target), "/" + main))
    }

    let plugins = ["./plugins/dht/plugin.js"].concat(api.config.plugins || []).map((plug) => {
      const res = require(plug)

      api.log("Plugin loaded", path.resolve(plug))

      if (!(res && _.isFunction(res.listen) && _.isFunction(res.end)) && _.isPlainObject(res) && Object.keys(res).length > 0) {
        const sub = []
        for (let i in res) sub.push(res[i])
        return sub
      }

      return [res]
    })

    const f = []
    plugins.forEach((item) => {
      for (let plug of item) f.push(plug)
    })

    plugins = f
    plugins = plugins.filter((item) => item && _.isFunction(item.listen) && _.isFunction(item.end)).map((item) => {
      const listen = item.listen()
      listen.end = item.end
      return listen
    })

    delete api.actions.start
    delete api.actions.init

    const peer = api.peer = Peer(api.actions, Object.assign({
      wrap: (d) => {
        return Timeout(d, api.config.connectionTimeout = api.config.connectionTimeout || api.config.timeout || ms('40s'), () => {
          d.end()
        })
      }
    }, api.config, { listeners: plugins }))

    const end = peer.end
    peer.end = (...args) => {
      api.shutdown = true
      end(...args)
    }

    api.actions.stop = Action({
      type: "async",
      desc: "Stops the Server",
      run: (cb) => {
        if (peer) peer.end()
        cb(null)
      }
    })

    api.config.listen.push("shs+tcp+unix://" + path.join("/", os.tmpdir(), name + ".sock"))
    
    api.config.listen
    .filter((addr) => peer.protoNames().indexOf(url.parse(addr).protocol) !== -1)
    .forEach((addr) => peer.listen(addr, { timeout: ms('40s') }))

    process.on("SIGHUP", () => { peer.end() })
    process.on("SIGINT", () => { peer.end() })

    api.shutdown = false

    api.peer.events = events.listen
    
    _(peer, _.drain(events.emit, events.end))

    _(
      peer.events(),
      peer.on({
        ready: (e) => {
          if (e.address && e.address.length > 0)
            api.log("Server listening on address: ", e.address.join(", "))
        },
        connection: (e) => {
          if (api.shutdown === true)  e.end("'peer cannot accept new connections, because it is shutting down'");

          api.log('Connection from', e.peerID, 'protocol', e.protocol, 'on', api.id)
        },
        connectionError: (e) => api.log('Connection error',
          e.error ? (e.error.message || e.error) : '',
          e.peerID ? ("from " + e.peerID) : '',
          e.protocol ? 'protocol ' + e.protocol : '',
          'on', api.id
        ),
        disconnection: (e) =>
          api.log('Disconnection',
            e.error ? (e.error.message || e.error) : '',
            e.peerID ? ("from " + e.peerID) : '',
            e.protocol ? 'protocol ' + e.protocol : '',
            'on', api.id
          ),
        end: (err) => err ? api.log.error("server error", err) : api.log("Server closed")
      })
    )

    cb(null)
  }

})

if (!api.config.test)
  connect((err, _e) => {
    e = _e
    if (e && e.peer.protoNames) {
      let timer = setInterval(() => {
        e.peer.protoNames(() => { })
      }, 2000)

      const end = e.end
      e.end = () => {
        clearInterval(timer)
        end()
      }

      process.on("SIGINT", () => { e.end() })
      process.on("SIGHUP", () => { e.end() })
    }

    api.actions.init = Action({
      type: "async",
      desc: "Create an project",
      run: (cb) => {
        if (!fs.existsSync("./package.json")) {
          let p = require(path.join(dir, '/template/package.json'))
          p.peerDependencies.alligator = "0.x"

          p.name = path.basename(process.cwd())
          fs.writeFileSync('./package.json', JSON.stringify(p, null, 2))
          api.log('package.json created.')
        }
        else api.log.warn('package.json already exists.')

        if (!fs.existsSync('./index.js')) {

          fs.writeFileSync('./index.js', fs.readFileSync(path.join(dir, '/template/index.js'), 'utf8'))
          api.log('index.js created.')
        }
        else api.log.warn('index.js already exists.')
        cb(null)
      }
    })

    if (e) Object.assign(api.actions, e.peer)

    if (!api.config.test)
      return CLI(api, (err) => {
        if (e) setTimeout(e.end, 100)
      });

  })