#!/usr/bin/env node
const { _ } = require('../')
const promiseToSource = require('pull-from-promise');
const superstruct = require("superstruct").superstruct
const traverse = require('traverse');
const asyncToSource = require("pull-async")
const minimist = require('minimist')
const { stdin, stdout } = require('pull-stdio')

module.exports = function (api, cb, name) {
  if(!name)name ="alligator"
  const data = []

  traverse(api.actions).forEach(function () {
    if (this.path.join(".") && _.isFunction(this.node)) data[this.path.join(".")] = this.node
  })

  function error(err, str) {
    console.error(err ? (err.message || err) : str)
    if (cb) {
      cb(err)
      cb = null;
      process.exitCode = 1
      return
    }

  }

  let lastCommand
  let lastArg
  let commands = process.argv.slice(2).filter((command) => {
    if (command.indexOf("--") !== -1 && data[command] == null) {
      lastArg = command
    }

    if (data[command] == null && data[lastCommand] != null && command.indexOf("--") === -1) {
      const flatInput = traverse(Array.isArray(data[lastCommand].input) || data[lastCommand].input instanceof Object ? data[lastCommand].input : []).reduce(function (acc) {
        if (this.path.length > 0) {
          acc["--" + this.path.join(".")] = this.node
        }
        return acc;
      }, {})
      if (data[lastCommand].input == null) return error("\nSee " + name +" "+ lastCommand + " --help \n\n" + "Error: no value allowed on command " + lastCommand)
      else if (data[lastCommand].input instanceof Object && lastArg && flatInput[lastArg] == null) {
        if (lastArg) return error("\nSee " + name +" "+ lastCommand + " --help \n\n" + "Error: command option " + lastCommand + " " + lastArg + " not found.")

        return error("\nSee " + name +" "+ lastCommand + " --help \n\n" + "Error: no value allowed on command " + lastCommand)
      }
      else if (data[lastCommand].input !== Object(data[lastCommand].input) && lastArg && flatInput[lastArg] == null) {
        return error("\nSee " + name +" "+ lastCommand + " --help \n\n" + "Error: command option " + lastCommand + " " + lastArg + " not found.")
      }


      else {
        if (data[lastCommand]._found >= 1 && !lastArg) return error("Invalid command " + command)
        if (data[lastCommand]) data[lastCommand]._found = data[lastCommand]._found ? data[lastCommand]._found++ : 1
      }
    }
    if (data[command]) {
      if (lastCommand) delete data[lastCommand]._found
      lastCommand = command
    }
    return command.indexOf("--") === -1 && data[command]
  })
  let last = -1;
  commands = process.argv.slice(2).reduce((a, b) => {
    if (commands.indexOf(b) !== -1) {
      last++
      a[last] = { key: b, args: [] }
      return a
    }
    if (a[last]) a[last].args.push(b)
    return a
  }, [])
  let cmd = process.argv.slice(2)[0]

  if (cmd && !data[cmd]) {
    if (cmd !== "--help")
      console.error("\nError:", "invalid command " + cmd)
    cmd = null;
  }

  if (!cmd) {
    console.error("\nUsage: "+name+" [Command] [Options]")
    console.error("\nCommands:")
    let padding = 0
    for (let i in data) padding = Math.max(padding, i.length)

    for (let k in data) console.log(k.padEnd(padding + 5) + (data[k].desc || ""))
    error("\nRun '"+name+" [Command] --help' for more information on a command.\n")
    return;
  }

  if (process.argv.slice(2).indexOf("--help") !== -1) commands = commands.map((command) => { if (command.args.indexOf("--help") == -1) command.args.push("--help"); return command })
  const actions = []
  for (let index in commands) {
    const command = commands[index]
    let argv = minimist([command.key, ...command.args])
    let args = argv._.slice(1)
    delete argv._
    if (Object.keys(argv).length === 0) args = [...args]
    else args = [...args, argv]
    const input = superstruct()(data[command.key].input || {}, data[command.key].defaults || {})
    
    if (argv["help"]) {
      const defaults = traverse(Array.isArray(input.defaults) || input.defaults instanceof Object ? input.defaults : [input.defaults]).reduce(function (acc) {
        if (!isNaN(this.path.join("."))) {

          if (this.path.length > 0) acc[this.path.join(".")] = this.node
          return acc
        }

        if (this.path.length > 0) acc["--" + this.path.join(".")] = this.node
        return acc;
      }, {})

      const required = traverse(input.schema).reduce(function (acc) {
        if (_.isString(this.node) && !this.node.endsWith("?")) {
          if (this.path.length === 0 || !isNaN(this.path.join("."))) {
            if (this.path.length === 0 && Object.keys(defaults).length === 1) this.path = [0]
            if (defaults[this.path.join(".")]) {
              acc.push(this.node + " ( default " + JSON.stringify(defaults[this.path.join(".")]) + " )")
              return acc;
            }

            acc.push(this.node)
          }
          else
            acc.push("--" + this.path.join(".") + " " + this.node)
        }
        return acc;
      }, [])

      const usage = data[command.key].usage ? traverse(data[command.key].usage).reduce(function (acc) {
        if (_.isString(this.node)) acc["--" + this.path.join(".")] = this.node
        return acc;
      }, {}) : undefined

      const opts = traverse(input.schema).reduce(function (acc) {
        if (_.isString(this.node)) {
          if (isNaN(this.path.join("."))) {
            if (this.path.length > 0) acc["--" + this.path.join(".")] = this.node
          }
        }
        return acc;
      }, {})

      console.error("\nUsage: " + command.key + " " + required.join(" ") + (Object.keys(opts).length > 0 ? " [Options] " : ""))
      if (data[command.key].desc) console.log("\n" + data[command.key].desc)

    
      if (Object.keys(opts).length > 0) console.error("\nOptions:")

      let padding = 0
      for (let i in opts) padding = Math.max(padding, i.length + " ".length + opts[i].length)

      for (let i in opts) {
        let str = ""
        if (usage && usage[i]) str = usage[i]
        if (defaults[i] != null) {
          str = str + " ( default "
          if (defaults[i] instanceof Object) {
            traverse(defaults[i]).forEach(function () {
              if (!(Array.isArray(this.node) || this.node instanceof Object)) {
                if (!isNaN(this.path[this.path.length - 1])) {
                  return str += i + " " + JSON.stringify(this.node) + " "
                  
                }
                
                str += i + "." + this.path.join(".") + " " + JSON.stringify(this.node) + " "
              }
            })
          }
          else str += JSON.stringify(defaults[i])

          str += " )"
        }
        console.error((i + " " + opts[i]).padEnd(padding + 5) + str)
      }
      if (index == commands.length - 1) return error("\n")
      console.error("\n")

    }
    else {
      try {
        if (input) {
        
          if (Array.isArray(data[command.key].input)) { input.call(null, args); }
          else input.call(null, ...args);
          
          if(command.key !="start"  && command.key !="run" && !process.stdin.isTTY && index ==0 ){ actions.push(stdin({encoding:null})) }
 
          if (data[command.key].type === "async" || data[command.key].type === "sync")
            actions.push(asyncToSource((cb) => {
              data[command.key](...args, cb)
            }))
          else if (data[command.key].type === "promise") actions.push(promiseToSource(data[command.key](...args)))
          else if (data[command.key].type === "sink") {
            actions.push(data[command.key](...args, (err) => {
              if (err) return error(err)
              if (cb) {
                cb(err)
                cb = null
              }
            }))
          }
          else actions.push(data[command.key](...args))

          if (index == commands.length - 1) {
            if (data[command.key].type !== "sink") {

              actions.push(_.map((item) => {
                if (!Buffer.isBuffer(item) && item !== undefined) return JSON.stringify(item) + "\n"
                return item;
              }))

              actions.push(_.filter((item) => item !== undefined))

              actions.push(stdout((err) => {
                if (err) return error(err)
                if (cb) cb()
              }))
            }

            _(...actions)
          }

        }
      }
      catch (err) {
        const required = traverse(input.schema).reduce(function (acc) {
          if (_.isString(this.node) && !this.node.endsWith("?")) {
            if (this.path.length === 0) {
              acc.push(this.node)
            }
            else
              acc.push("--" + this.path.join(".") + " " + this.node)
          }
          return acc;
        }, [])

        error("\nSee "+ name + " " + command.key + " --help \n\n" + "Usage: "+name+" " + command.key + " " + required.join(" ") + " \n\n" + command.key + " error: " + err.message + "\n\n" + data[command.key].desc)
      }
    }
  }
}