const { Async, Sync, AsyncPromise, Source, Sink, Duplex, _ } = require('icebreaker-rpc')

module.exports = function Action(opts) {
  let action

  if (!opts || !opts.type) throw new Error("type is required")
  if (!opts.run) throw new Error("run function is required")

  let type = opts.type
  const run = opts.run
  delete opts.run

  if (type === "async") action = Async(run, opts)
  else if (type === "promise") action = AsyncPromise(run, opts)
  else if (type === "sync") action = Sync(run, opts)
  else if (type === "duplex") action = Duplex(run, opts)
  else if (type === "sink") action = Sink(run, opts)
  else if (type === "source") action = Source(run, opts)
  
  if (!action) throw TypeError("unknown type: " + type)

  return action
}