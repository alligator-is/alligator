const fs = require("nodejs-fs-utils");
const os = require('os')
const test = require("tape")
const ms = require('ms')
const cluster = require('cluster');

let start = 8
let count = start

if (cluster.isMaster) {
  
  try {
    fs.rmdirsSync(".test")
  
  }
  catch (err) { }

  process.on("SIGINT", () => { })
  process.on("SIGHUP", () => { })

  console.log(`Master ${process.pid} is running`);

  let readyCount = 0
  let endCount = 0
  let replicate = 0
  let seen = {}
  
  function startWorker(t, cb) {
    const worker = cluster.fork();

    worker.on("message", function (e) {
      e = JSON.parse(e)
      
      if (e.type === "ready") {
        ++readyCount
        if (readyCount === count) t.equal(readyCount, count)

        t.equal(e.type, "ready", "peer " + worker.id + "is ready")
        setTimeout(() => {
          cb(worker)
        }, 422)
      }
      
      if (e.type == "replicate") {
        if (!seen[worker.id]) {
          ++replicate
          seen[worker.id] = true
        }
      
        if (replicate === count) {
          for (let k in cluster.workers) {
            let w = cluster.workers[k]
            w.send(JSON.stringify({ type: "end" }))
          }
        }

      }

      if (e.type == "end") {
        t.notOk(e.err)
        ++endCount
        if (endCount === count) t.equal(endCount, count)
        worker.kill()
      }

    })

    return worker
  }

  test(start + " peers", function (t) {
    t.plan(start * 3 + 2)
    let first = false
    startWorker(t, function next(worker) {
      start--
      if (start > 0) setTimeout(function () {
        startWorker(t, next)
      }, 200)

    })

    cluster.on('exit', (worker, code, signal) => {
      t.ok(true)
      console.log(`worker ${worker.process.pid} closed`);
    });

  })

}
else {

  const { Connect } = require("icebreaker-rpc")

  const { Action, _, api } = require('./')
  const path = require("path")
  api.config = {}
  api.config.logLevel = 7
  api.config.test = "testalligator" + cluster.worker.id

  api.config.bucketRefresh = api.config.bucketRefresh || ms('30s')
  api.config.replicate = api.config.replicate || ms('30s')
  api.config.bootstrap = api.config.bootstrap || []

  api.config.path = ".test/" + cluster.worker.id
  require("./bin.js")
  let opts2 = { listen: ['shs+tcp://[::]:423' + cluster.worker.id] }

  api.config.exclusive = true;

  const mkdirp = require("mkdirp")
  try {

    mkdirp.sync(".test/1");
  }
  catch (err) { }

  const peerInfo = require('./lib/peerInfo.js').loadOrCreateSync(path.join(".test/" + 1, 'peerInfo'), { appKey: "test" })
  const key = JSON.parse(peerInfo.toJSON())["keys"]["publicKey"]

  if (cluster.worker.id > 1) api.config.bootstrap = ['shs+tcp://' + encodeURIComponent(key) + "@" + '[::]:4231']

  process.on("message", function (e) {
    e = JSON.parse(e)
    if (e.type === "end" && api.actions.stop)
      api.actions.stop(function () {})
  })

  const listen = () => {
    _(api.events(), _.map((item) => {
      process.send(JSON.stringify(item))
      return item
    }), api.events.on({
      end: function (err) {
        process.send(JSON.stringify({ type: "end", err: err }))
      }
    }))
  }

  if (cluster.worker.id > 1) {
    Connect("shs+tcp+unix://" + encodeURIComponent(key) + "@" + path.posix.join("/", os.tmpdir(), "testalligator1.sock", "/") + peerInfo.appKey, null,
      api.config, (err, e) => {
        if (err) { throw Error("cannot connect to unixsocket"); }
        listen()
        setTimeout(() => {
          e.end()
          api.actions.start(opts2, function () {
            process.on("SIGINT", api.actions.stop)
            process.on("SIGHUP", api.actions.stop)
          })
        }, 200)
      })

    return
  }

  listen()

  api.actions.start(opts2, function () {
    process.on("SIGINT", api.actions.stop)
    process.on("SIGHUP", api.actions.stop)
  })

}