#!/usr/bin/env node

var address = require('network-address')
var home = require('osenv').home
var name = process.env.alligator_appname || 'alligator'
var path = require('path')
var Peer = require('./')
var muxrpcli = require("muxrpcli")
var mkdirp = require("mkdirp")
var Manifest = require("./lib/manifest")("./bin.md", __filename)
var fs = require('fs')
var flatten = require("flat").flatten
var unflatten = require("flat").unflatten
var valid = require('muxrpc-validation')()
var os = require('os')
var merge = require('map-merge')
var pick = require('lodash.pick')
var _ = require("icebreaker")
var configDir = path.join(home(), '.' + name)
var peerInfo = require('./lib/peerInfo.js').loadOrCreateSync(path.join(configDir, 'peerInfo'))
var connect = require("./lib/client.js").bind(null, "shs+tcp+unix://" + encodeURIComponent(JSON.parse(peerInfo.toJSON())["id"]) + "@" + path.join("/", os.tmpdir(), name + ".sock"))
var docs  = path.dirname(fs.realpathSync(__filename))

connect(function (err, e) {

  var api = {
    usage: valid.async(function (command, cb) {
      var usage = Manifest.usage({command:command})
      if (command && usage) return cb(null, usage)
      if (e && e.peer)
        return e.peer.cli.usage(command, function (err, data) {
          if (err) return cb(err)
          if (data) {
            data = data.replace("\nCommands:\n", "")

            if (usage && !command && data) data = usage + "\n" + data
          }
          if (command && !data) return api.usage(false, cb)
          cb(null, data)
        })
      if (command) return cb("command " + command + " not found")
      cb(null, usage)
    }, ['string?']),
    start: valid.async(function (target, opts, cb) {
      if (typeof target == 'function') cb = target, target = null
      if (typeof opts == 'function') cb = opts, opts = null
      if (typeof target == 'object') opts = target, target = null
      opts = opts || {}
      opts.config = opts.config || {}

      if (opts.config.listen && !Array.isArray(opts.config.listen)) opts.config.listen = [opts.config.listen]

      if (Array.isArray(opts.config.listen)) opts.config.listen = opts.config.listen.map(function (addr) {
        return addr.replace("[::1]", "[" + address.ipv6() + "]").replace("://localhost", "[" + address.ipv4() + "]")
      })

      var listen = opts.config.listen || [
        'shs+tcp://[' + address.ipv6() + ']:4239',
        'shs+ws://[' + address.ipv6() + ']:4238'
      ]

      if (address.ipv6() === "::1" && !opts.config.listen)
        listen = [
          'shs+tcp://' + address.ipv4() + ':4239',
          'shs+ws://' + address.ipv4() + ':4238'
        ]

      listen.push("shs+tcp+unix://" + path.join("/", os.tmpdir(), name + ".sock"))

      opts.config.listen = listen
      opts.config.path = configDir

      var config = require('rc')(name, opts.config)
      config.dht = config.dht || {}
      mkdirp.sync(config.path)
      config.info = peerInfo
      if (opts && opts.b) config.bootstrap = opts.b.split(",")

      var peer = new Peer(config)

      if (e) {
        peer.logger.error("Can't start because " + name + " is already running  – shut it down first!")
        return e.end()
      }

      if (target) {
        var main = require(path.join(path.resolve(target), "/package.json")).main
        peer.logger.log("Plugin loaded", path.join(path.resolve(target), "/" + main))
        peer.addProtocol(require(path.join(path.resolve(target), "/" + main)))
      }

      process.on("SIGINT", peer.stop.bind(peer))
      process.on("SIGHUP", peer.stop.bind(peer))
      process.on('SIGUSR2', peer.stop.bind(peer, peer.start.bind(peer)))

      peer.start()


    }, ['string?'], ['object?'], ['string', 'object']),
    init: valid.async(function (cb) {
    
      if (!fs.existsSync("./package.json")) {
        var p = require(path.join(docs, '/template/package.json'))
        p.dependencies.alligator = require('./package.json').version

        p.name = path.basename(process.cwd())
        fs.writeFileSync('./package.json', JSON.stringify(p, null, 2))
        console.log('package.json created.')
      }
      else console.warn('package.json already exists.')

      if (!fs.existsSync('./index.md')) {

        fs.writeFileSync('./index.md', fs.readFileSync(path.join(docs, '/template/index.md'), 'utf8'))
        console.log('index.md created.')
      }
      else console.warn('index.js already exists.')

      if (!fs.existsSync('./index.js')) {

        fs.writeFileSync('./index.js', fs.readFileSync(path.join(docs, '/template/index.js'), 'utf8'))
        console.log('index.js created.')
      }
      else console.warn('index.js already exists.')


      cb()
    }),
    stop: valid.async(function (cb) {
      if (err) return cb(err)
      e.peer.cli.stop(function () {
        cb(null, "Alligator is stopped")
      })

    })
  }

  var manifest = Manifest.manifest()
  if (e) {
    if (e && e.manifest) manifest = merge(manifest, e.manifest)
    var paths = Object.keys(flatten(e.manifest, { safe: true }))
    var filtered = unflatten(pick(flatten(e.peer, { safe: true }), paths), { safe: true })
    api = merge(api, filtered)
  }

  return muxrpcli(process.argv.slice(2), manifest, api)

})