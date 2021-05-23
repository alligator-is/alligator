#!/usr/bin/env node
const { Action, _, api } = require('./')
const { Connect } = require("icebreaker-rpc")
const path = require('path')
const os = require('os')
const CLI = require("./lib/cli")
const address = require('network-address')
const fs = require("fs")
const test = api.config && api.config.test || null
const name = process.env.alligator_appname || test || 'alligator'
const dir = path.dirname(fs.realpathSync(__filename))
const LB = require("alligator-client/lb")
const url = require("url")
const Timeout = require("alligator-client/timeout")
const createStart = require("./lib/start")
const assign = require('assign-deep');

api.config.listen = api.config.listen || [
  'shs+tcp://[::]:4239'
]

if (address.ipv6() === "::1")
  api.config.listen = api.config.listen || [
    'shs+tcp://0.0.0.0:4239',
    'shs+ws://0.0.0.0:4238'
  ]

require("./lib/logger")
const config = {...api.config}
config["wrap"]=  (d) => {
  return Timeout(d, api.config.connectionTimeout, () => {
    d.end()
  })
}
const connect = Connect.bind(null, "shs+tcp+unix://" + encodeURIComponent(api.id) + "@" + path.join("/", os.tmpdir(), name + ".sock"), null,config)
const network = require('icebreaker-network')

function createRun(opts){
  return Action({
    type: "async",
    desc: "Starts the client",
    usage: {
      target: "path, to your project directory",
    },
    input: {
      target: "string?",
      logLevel: "number",
      bootstrap: "array?|string?"
    },
    defaults: {
      listen: api.config.listen,
      logLevel: api.config.logLevel
    },
    run: (opts, cb) => {
      opts = opts||{}
      opts.listen=[]
      opts.server=false
      api.actions.start(opts,cb)
    }
  })
}

api.actions.lb={}

if (!api.config.test)
return connect((err, e) => {  
  function SingleConnect(address,local,opts,cb){
    const id = url.parse(address).auth
    for (let k in api.connections) {
      let c = api.connections[k]
      if (c.peerID === id) return cb(null, c)
    }
    Connect(address,local,opts,cb)
  }
  if(!api.connections) api.connections = {}
  let cid =0;

  if(!api.connect && e)api.connect = function(addresses,cb){
    if (_.isString(addresses)) addresses = [addresses]
      
    const addrs = addresses.slice(0).filter(function (addr) {
      return network.protoNames().indexOf(url.parse(addr).protocol) !== -1
    })
    .sort(function sortFunc(a, b) {
      const sortingArr = network.protoNames()
      return sortingArr.indexOf(url.parse(a[1]).protocol) - sortingArr.indexOf(url.parse(b[1]).protocol)
    })
    
    if (addrs.length === 0 && addresses.length > 0) return cb(new Error("protocol not found in Address:" + JSON.stringify(addresses)))
    
      SingleConnect(addrs.shift(), null, config,function cb2(err,con){
          if(!err && con){
            con.id = cid=++cid;
            api.connections[con.id]=con;
    
          }
      if (addrs.length > 0 && err != null) return SingleConnect(addrs.shift(), null, config, cb2)
        cb(err, con)
   
    })
  
  };

  api.actions.start = createStart(e)
  api.actions.run  = createRun()

  if (e && e.peer.protoNames) {
    let timer = setInterval(() => {
      e.peer.protoNames(() => { })
    }, 2000)
    
    const end = e.end
    e.end = () => {
      for(let c in api.connections){
        if(api.connections[c] && api.connections[c].end)api.connections[c].end()
      }
      api.connections={}
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
  if(e && e.peer.addrs){
    return LB({config:api.config,addrs:e.peer.addrs,connect:api.connect,live:false},function(lb){      
     assign(api.actions.lb,lb)  
     if (!api.config.test)
     return CLI(api, (err) => {
       if (e) setTimeout(e.end, 100)
     });
    })  
    
   }

  if (!api.config.test)
    return CLI(api, (err) => {
      if (e) setTimeout(e.end, 100)
    });

})

api.actions.start = createStart()
api.actions.run  = createRun()


