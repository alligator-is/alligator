#!/usr/bin/env node

var address = require('network-address')
var ms = require('ms')
var home = require('osenv').home
var name = process.env.alligator_appname || 'alligator'
var path = require('path')
var Peer = require('./')
var muxrpcli = require("muxrpcli")
var mkdirp = require("mkdirp")
var mdm = require('mdmanifest')
var fs   = require('fs')
var path = require('path')
var docs  = path.dirname(fs.realpathSync(__filename))
var commands =fs.readFileSync(path.join(docs,'bin.md')).toString()
var valid = require('muxrpc-validation')()
var network = require('icebreaker-network')

var api = {
  usage: valid.async(function(command,cb){ cb(null,mdm.usage(commands,command))  }, ['string?']),
  start: valid.async(function(target,opts,cb){
    if (typeof target == 'function') cb = target, target = null
    if (typeof opts == 'function')   cb = opts, opts = null
    if (typeof target == 'object') opts = target, target = null
    opts = opts||{}
    opts.config = opts.config||{}

    if(opts.config.listen && !Array.isArray(opts.config.listen ))opts.config.listen=[opts.config.listen]
    
    if(Array.isArray(opts.config.listen))opts.config.listen=opts.config.listen.map(function(addr){
      return addr.replace("[::1]","["+address.ipv6()+"]").replace("://localhost","["+address.ipv4()+"]")
    })

    var listen = opts.config.listen||[
      'shs+tcp://[' + address.ipv6() + ']:4239',
      'shs+ws://[' + address.ipv6() + ']:4238'
    ] 

    if(address.ipv6() ==="::1" && !opts.config.listen)
    listen = [
      'shs+tcp://' + address.ipv4() + ':4239',
      'shs+ws://' + address.ipv4() + ':4238'
    ]
   
    opts.config.listen  = listen
    opts.config.path = path.join(home(), '.' + name)
    
    var config = require('rc')(name, opts.config)
    config.dht = config.dht||{}
    mkdirp.sync(config.path)
    config.info = require('./lib/peerInfo.js').loadOrCreateSync(path.join(config.path, 'peerInfo'))
    if(opts && opts.b)config.bootstrap = opts.b.split(",")
    
    
    var peer = new Peer(config)
    if(!target && fs.existsSync("./package.json")){
      target="."
    }

    if(target){
      var main = require(path.join(path.resolve(target),"/package.json")).main
      peer.logger.log("Plugin loaded",path.join(path.resolve(target),"/"+main)  )
      peer.addProtocol(require(path.join(path.resolve(target),"/"+main)  ))
    }

    peer.start()

    process.on("SIGINT", peer.stop.bind(peer))
    process.on("SIGHUP", peer.stop.bind(peer))
    process.on('SIGUSR2', peer.stop.bind(peer, peer.start.bind(peer)))
    
  },['string?'],['object?'],['string', 'object']),
  init:valid.async(function(cb){
    if(!fs.existsSync("./package.json")){
      var p = require(path.join(docs,'/template/package.json'))
      p.dependencies.alligator=require('./package.json').version
      
      p.name = path.basename(process.cwd())
      fs.writeFileSync('./package.json',JSON.stringify(p,null,2))
      console.log('package.json created.')
    }
    else console.warn('package.json already exists.')

    if(!fs.existsSync('./index.js')){
    
      fs.writeFileSync('./index.js',fs.readFileSync(path.join(docs,'/template/index.js'),'utf8'))
      console.log('index.js created.')
    }
    else console.warn('index.js already exists.')

    cb()
  })
}

muxrpcli(process.argv.slice(2), mdm.manifest(commands), api)
