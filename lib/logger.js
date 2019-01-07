const {api,_} = require('../')
var chalk = require('chalk')
var moment = require('moment')
const notify= _.notify()

api.config.logLevel = api.config.logLevel || 7

api.log = function(...args){ api.log.info(...args)  }

api.log.warn = function (data) {
    notify({ type: 'log', level: 'warning', id: 4, data: [].slice.call(arguments) })
}

api.log.info = function (data) {
    notify({ type: 'log', level: 'info', id: 6, data: [].slice.call(arguments) })
}

api.log.error = function (data) {
    notify({ type: 'log', level: 'error', id: 3, data: [].slice.call(arguments) })
}

api.log.debug = function (data) {
    notify({ type: 'log', level: 'debug', id: 3, data: [].slice.call(arguments) })
}

api.log.events = function(){
    return _(notify.listen(),_.filter((e)=>{
        api.config.logLevel = api.config.logLevel || 7
        if (e.level === "warning" && api.config.logLevel < 4) return false
        if (e.level === "error" && api.config.logLevel < 3) return false
        if (e.level === "info" && api.config.logLevel < 6) return false
        if (e.level === "debug" && api.config.logLevel < 7) return false
        return true
    }))
}

_(api.log.events(),_.drain(function(e){
    var c
    if (e.level === 'info') c = chalk.green
    if (e.level === 'error') c = chalk.red
    if (e.level === 'warning') c = chalk.bold
    if (e.level == 'debug') c = chalk.cyan
    let first = false
    console.log.apply(console, [].concat(e.data.filter(function(item){return item!=""}).map(function (d) {
      if (d instanceof Error) d = d.message
        
      if (first == false) {
        d = '[ ' + moment().format() + ' ] ' + c(e.level + ': ') + d
        first = true
      }
      return d
    })))},function(){
  }))