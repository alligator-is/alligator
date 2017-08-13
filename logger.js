var _ = require('icebreaker')
var chalk = require('chalk')
var moment = require('moment')

var Logger = module.exports = function Logger(api) {
  if (!(this instanceof Logger)) return new Logger(api)

  var logLevel = api.config.logLevel = api.config.logLevel || 7

  this.log = function (data) {
    if (logLevel < 6) return
    api._notify({ type: 'log', level: 'info', id: 6, data: [].slice.call(arguments) })
  }

  this.warn = function (data) {
    if (logLevel < 4) return
    api._notify({ type: 'log', level: 'warning', id: 4, data: [].slice.call(arguments) })
  }

  this.info = function (data) {
    if (logLevel < 6) return
    api._notify({ type: 'log', level: 'info', id: 6, data: [].slice.call(arguments) })
  }

  this.error = function (data) {
    if (logLevel < 3) return
    api._notify({ type: 'log', level: 'error', id: 3, data: [].slice.call(arguments) })
  }

  this.debug = function (data) {
    if (logLevel < 7) return
    api._notify({ type: 'log', level: 'debug', id: 3, data: [].slice.call(arguments) })
  }

  var self = this

  var events = api.events

  _(events(), events.on({
    ready: function (e) {
      e.address.forEach(function (addr) {
        self.log('peer listening on: ' + addr)
      })

      self.log('peer is ready')

    },
    log: function (e) {
      var c
      if (e.level === 'info') c = chalk.green
      if (e.level === 'error') c = chalk.red
      if (e.level === 'warning') c = chalk.bold
      if (e.level == 'debug') c = chalk.cyan
      var first = false
      console.log.apply(console, [].concat(e.data.map(function (d) {
        if (d instanceof Error) d = d.message

        if (first == false) {
          d = '[ ' + moment().format() + ' ] ' + c(e.level + ': ') + d
          first = true
        }
        return d
      })))
    }
    ,
    end: function (err) {
      console.log('end', err)
    }
  }
  ))

}