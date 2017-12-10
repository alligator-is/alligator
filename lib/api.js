var _ = require('icebreaker')
var Swarm = require('./swarm')
var Cli = require('./cli')
var url = require('url')
var PeerInfo = require('./peerInfo')
var Logger = require('./logger')
var DHT = require('./dht')
var DB = require('./db')
var ms = require('ms')
var paramap = require('pull-paramap')
var _ = require("icebreaker")

function API(config) {
  if (!(this instanceof API)) return new Peer(config)
  this.config = config
  this.config.info = this.config.info || PeerInfo()
  this.path = "api"

  this.state = 'ended'
  this.util = Swarm.util
  this.id = this.util.encode(config.info.id, config.info.encoding)
  var _protos = []
  var _notify = _.notify()

  this.events = function () {
    return _notify.listen()
  }

  this.events.combine = require('icebreaker-network/lib/combine')
  this.events.asyncMap = require('icebreaker-network/lib/asyncMap')
  this.events.map = require('icebreaker-network/lib/map')
  this.events.on = function (events) {
    return _(paramap(function (item, cb) { cb(null, item) }), require('icebreaker-network/lib/on')(events))
  }

  this.logger = require('./logger')({ config: this.config, events: this.events, _notify: _notify })

  this.start = function (cb) {
    if (this.state === 'ended') {
      this.state = 'start'
      var self = this
      var swarm = Swarm(this)
      
      var plugins = [Cli, DB, DHT].concat(_protos).map(function (plug) {
        plug = plug(self, _)
        self.swarm.addProtocol(plug)
        return plug
      })

      plugins = plugins.filter(function (item) { return 'function' === typeof item })

      self.config.listen.filter(function (addr) {
        return self.swarm.protoNames().indexOf(url.parse(addr).protocol) !== -1
      })
        .forEach(function (addr) {
          self.swarm.listen(addr, { timeout: ms('40s') })
        })

      var combined = self.events.combine.apply(null, [swarm].concat(plugins.slice(0)))
      self._end = combined.end
      _(combined, self.events.asyncMap({
        ready: function (e, done) {
          self.state = e.type
          if (cb) cb(null, e)
          cb = null
          done(e)
        }
      }), _.drain(_notify, function (err) {
        self.state = 'ended'
        _notify.end(err)
      })

      )

    }
  }

  this.addProtocol = function (protocol) {
    _protos.push(protocol)
  }
  
  var self = this
  var queue = []
  
  this.stop = function (cb) {

    if (self._end === null) {
      if (cb) {
        cb()
        cb = null
      }
      return
    }
    if (self.state != 'ended')
      _(_notify.listen(), self.events.on({
        end: function (err) {
          if (cb) cb(err)
          cb = null
          self.state = 'ended'
          self._end = null
        }
      }))

    if (self._end != null) {
      self._end()
      delete self._end
    }
  }
}


module.exports = API