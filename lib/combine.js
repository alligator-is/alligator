'use strict'
var _ = require('icebreaker')
var util = require('icebreaker-network/lib/util')
var on = require('icebreaker-network/lib/on')
var map = require('icebreaker-network/lib/map')

function take(n, cb) {
  var c = 0

  return function (cb2) {
    if (c < n || n == c) {
      ++c
    }
    if (c < n) return
    if (n == c) return cb2()
    throw new Error('to many function calls!')
  }

}

module.exports = function combine() {

  var listeners = [].slice.call(arguments)

  if (listeners.length === 1) {
    var l = listeners.shift()
    var s = _(l, map({
      ready: function (e) {
        e.address = [e.address]
        return e
      }
    }
    ))
    s.protocol = l.protocol
    s.type = l.type
    s.end = l.end

    if (l.push) s.push = l.push

    return s
  }

  var notify = _.notify()
  var ready = take(listeners.length)
  var end = take(listeners.length)

  var _err = null, queue = [], _ready = [], ending = []

  listeners.forEach(function (l, i) {
    _(l,
      _.drain(function (e) {
        if (e.type == 'ready') {
          queue.push(e)
          ready(function () {
            notify({
              type: 'ready',
              address: queue.reduce(function (a, b) {
                if (b.address != null) {
                  if (Array.isArray(b.address)) {
                    b.address.forEach(function (addr) {
                      a.push(addr)
                    })
                    return a
                  }
                  a.push(b.address)
                }
                return a
              }, [])
            })
            queue = []
          })
          _ready.push(i)
          return
        }
        notify(e)
      }, function (err) {
        if (err) _err = err
        listeners.forEach(function (l2, i2) {
          if (ending.indexOf(i2) === -1) {
            ending.push(i2)
            l2.end(err)
          }
        })
        end(function () {
          notify.end(_err)
          _err = null
          queue = null
          ending = null
        })
      }))
  })


  var source = notify.listen()

  source.push = function () {
    var args = arguments
    listeners.forEach(function (l) {
      if (_.isFunction(l.push)) l.push.apply(null, [].slice.call(args))
    })
  }

  source.end = function () {
    if (_ready.length > 0)
      return listeners[_ready.shift()].end()
    notify.end(true)
  }

  return source
}