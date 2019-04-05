const { Peer} = require("icebreaker-rpc")
const Timeout = require("./timeout")
const url = require('url')
const ms = require('ms')
const { Action, _, api } = require('.././')
const path = require("path")
const os = require('os')
const test = api.config && api.config.test || null
const name = process.env.alligator_appname || test || 'alligator'
const appKey = process.env.alligator_appkey || test ? "test" : 'alligator@1.0.0'
const mkdirp = require("mkdirp")
const home = require('osenv').home


api.config = api.config || {}
api.config.path = api.config.path || path.join(home(), '.' + name)
mkdirp.sync(api.config.path);

const peerInfo = require('./peerInfo.js').loadOrCreateSync(path.join(api.config.path, 'peerInfo'), { appKey: appKey })
api.id = JSON.parse(peerInfo.toJSON())["keys"]["publicKey"]
Object.assign(api.config, peerInfo)

module.exports = (e)=>{
  
  const events = _.events()
  api.events = events.listen
  api.events.on = require("icebreaker-network").on
  api.events.map = require("icebreaker-network").map
  api.events.asyncMap = require("icebreaker-network").asyncMap
  api.events.paraMap = require("icebreaker-network").paraMap
  api.events.combine = require("icebreaker-network").combine
    
return Action({
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

      if (!api.config.test) api.config = require('rc')(name, api.config)
      
      if (_.isFunction(opts)) {
        cb = cb || opts
        opts = {}
      }
      
      if (_.isString(opts.listen)) opts.listen = [opts.listen]
      if (_.isString(opts.bootstrap)) opts.bootstrap = [opts.bootstrap]
      api.config.bootstrap =  opts.bootstrap||api.config.bootstrap
      api.config.listen =  opts.listen||api.config.listen
      api.config.logLevel = opts.logLevel||api.config.logLevel
      api.config.connectionTimeout = api.config.connectionTimeout || api.config.timeout || ms('40s')
      
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
      let plugins = [path.resolve(__dirname+"/../plugins/core/plugin.js")].concat(api.config.plugins || []).map((plug) => {
        const res = require(plug)

        api.log("Plugin loaded", path.resolve(plug))
        if (!(res && _.isFunction(res.listen) && _.isFunction(res.end)) && _.isPlainObject(res) && Object.keys(res).length > 0) {
          const sub = []
          for (let i in res) sub.push(res[i]())
          return sub
        }
        
        return [res()]
      
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
          return Timeout(d, api.config.connectionTimeout, () => {
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
          if (peer){
            _(peer.events(),_.onEnd((err)=>{
              cb(null)
              if(process.send && !api.config.test)
              setTimeout(()=>{
                process.exit(err?1:0)
              },1000)
            }))
            peer.end()
          } 
        }
      })
      
      if(api.config.listen && api.config.listen.length>0)
      api.config.listen.push("shs+tcp+unix://" + path.join("/", os.tmpdir(), name + ".sock"))
      
      api.config.listen
      .filter((addr) => peer.protoNames().indexOf(url.parse(addr).protocol) !== -1)
      .forEach((addr) => peer.listen(addr, { timeout: ms('40s') }))
      
      const stop =  () => { 
        api.actions.stop(()=>{
          
        })
      }
      
      process.on("SIGHUP",stop)
      process.on("SIGINT", stop)
     
      if (process.send)
      process.on("message",(msg)=>{ if (msg == 'shutdown') stop()})

      api.shutdown = false
  
      api.peer.events = events.listen
      
      _(peer, _.drain(events.emit, events.end))
  
      _(
        peer.events(),
        peer.on({
          ready: (e) => {
            if (e.address && e.address.length > 0)
              api.log("Server listening on address: ", e.address.join(", "))
              if (!api.config.test && process.send)process.send("ready")
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
}
