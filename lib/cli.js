var valid = require("muxrpc-validation")()
var Manifest = require("./manifest")("./cli.md", __filename)
var flatten = require("flat").flatten
var endsWith = require('lodash.endswith');
var clone = require('lodash.clonedeep')
module.exports = function (api, _) {
  return {
    path: "cli",
    manifest: Manifest.manifest(),
    permissions: {
      anonymous: {
        stop: false
      }
    },
    usage: valid.async(function (command, cb) {
      var capi = {}
      for (var i in api) capi[i] = clone(api[i])

      if (_.isFunction(command)) {
        cb = command
        command = null
      }

      if (command && command.indexOf("cli") === 0) return cb(null, Manifest.usage({ command: command, prefix: "cli" }));
      var capi = flatten(capi)
      if (command) {
        var search = function search(command, original, cb) {
          var usage = capi[command + ".usage"]

          if (!usage) {
            var c = command.split(".")
            c.pop()
            if (c.length > 0) return search(c.join("."), original, cb)

            return cb(null, null)
          }

          if (usage && _.isFunction(usage)) {
            if (original) {
              var o = original.replace(command, "")
              if (o.indexOf(".") === 0) o = o.replace(".", "")
              return usage.call(null, { command: o, prefix: command }, cb)
            }

          }

        }
        return search(command, command, cb)
      }

      _(
        Object.keys(capi),
        _.filter(function (i) {
          return endsWith(i, ".usage") && i !== "cli.usage" && _.isFunction(capi[i])
        }),
        _.asyncMap(function (i, cb) {
          var s = i.split(".")
          s.pop()
          s = s.join(".")
          capi[i].call(null, {
            command: command,
            prefix: s
          },
            function (err, data) {
              if (err) return cb(err)
              cb(err, data.replace("\nCommands:", ""))
            })
        }),
        _.collect(function (err, data) {
          if (err) return cb(err)
          var r = Manifest.usage({ command: command, prefix: "cli" });
          r = [r]
          if (data) r = r.concat(data)
          cb(null, r.join())
        })
      )

    }, ['string?']),
    stop: valid.async(api.stop)
  }
}