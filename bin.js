#!/usr/bin/env node
const { Action, _, api } = require('./')
const { Connect, Local } = require("icebreaker-rpc")
const path = require('path')
const os = require('os')
const CLI = require("./lib/cli")
const address = require('network-address')
const fs = require("fs")
const test = api.config && api.config.test || null
const name = process.env.alligator_appname || test || 'alligator'
const dir = path.dirname(fs.realpathSync(__filename))


const createStart = require("./lib/start")

api.config.listen = api.config.listen || [
  'shs+tcp://[::]:4239'
]

if (address.ipv6() === "::1")
  api.config.listen = api.config.listen || [
    'shs+tcp://0.0.0.0:4239',
    'shs+ws://0.0.0.0:4238'
  ]

require("./lib/logger")

const connect = Connect.bind(null, "shs+tcp+unix://" + encodeURIComponent(api.id) + "@" + path.join("/", os.tmpdir(), name + ".sock"), null, api.config)

if (!api.config.test)
return connect((err, e) => {  
  api.actions.start = createStart(e)
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

api.actions.start = createStart()
