#!/usr/bin/env node

var address = require('network-address')
var home = require('osenv').home
var name = process.env.alligator_appname || 'alligator'
var path = require('path')
var Peer = require('./')
var muxrpcli = require("muxrpcli")
var mkdirp = require("mkdirp")
var mdm = require('mdmanifest')
var fs   = require('fs')
var docs  = path.dirname(fs.realpathSync(__filename))
var commands =fs.readFileSync(path.join(docs,'bin.md')).toString()
var valid = require('muxrpc-validation')()
var os = require('os')
var PullCont = require('pull-cont')
var _ = require("icebreaker")

var configDir = path.join(home(), '.' + name)
var peerInfo = require('./lib/peerInfo.js').loadOrCreateSync(path.join(configDir, 'peerInfo'))
var connect = require("./lib/client.js").bind(null,"shs+tcp+unix://" +encodeURIComponent(JSON.parse(peerInfo.toJSON())["id"]) +"@"+  path.join("/",os.tmpdir(),name+".sock"))

var api = {
  usage: valid.async(function(command,cb){ cb(null,mdm.usage(commands,command))  }, ['string?']),
  start: valid.async(function(target,opts,cb){
    connect(function(err,e){
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

    listen.push("shs+tcp+unix://"+path.join("/",os.tmpdir(),name+".sock"))

    opts.config.listen  = listen
    opts.config.path = configDir
    
    var config = require('rc')(name, opts.config)
    config.dht = config.dht||{}
    mkdirp.sync(config.path)
    config.info = peerInfo
    if(opts && opts.b)config.bootstrap = opts.b.split(",")
    
    var peer = new Peer(config)
    
    if(e){
      peer.logger.error("Can't start because " + name + " is already running  – shut it down first!")
      return e.end()
    }

    if(target){
      var main = require(path.join(path.resolve(target),"/package.json")).main
      peer.logger.log("Plugin loaded",path.join(path.resolve(target),"/"+main)  )
      peer.addProtocol(require(path.join(path.resolve(target),"/"+main)  ))
    }
    
    process.on("SIGINT", peer.stop.bind(peer))
    process.on("SIGHUP", peer.stop.bind(peer))
    process.on('SIGUSR2', peer.stop.bind(peer, peer.start.bind(peer)))

    peer.start()
  })
  
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
  }),
  ls:valid.source(function(opts){
    return PullCont(function(cb){
      connect(function(err,e){
        if(err) cb(err);
        cb(null,e.peer.db.ls({old:true,live:false,include_docs: true}))
      })
    })
  }),
  stop:valid.async(function(cb){
      connect(function(err,e){
        if(err) return cb(err)
        e.peer.swarm.stop(function(err){
            cb(null,"Alligator is stopped")
        })
      })
  })
}

muxrpcli(process.argv.slice(2), mdm.manifest(commands), api)