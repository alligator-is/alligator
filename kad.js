var mdm = require('mdmanifest')
var doc = require('./apidocs').kad
var _ = require('icebreaker')
var valid = require('muxrpc-validation')()
var ms = require('ms')
var kad = require('kad')
var inherits = require('util').inherits;
var assert = require('assert');
var cl = require('chloride')
var url = require('url')
var util = require('./swarm').util
var Quasar = require('kad-quasar').Protocol;

module.exports = function (api) {
  // use sha256 for keys
  kad.constants.B = 256
  
  kad.utils.createID = function (data, encoding) {
    if (kad.utils.isValidKey(data)) return data;
    return util.encode(cl.crypto_hash_sha256(util.decode(data, encoding)), 'hex')
  }

  kad.constants.T_RESPONSETIMEOUT = ms('15s')

  function Node(params) {
    if (!(this instanceof Node)) return new Node(params);
    this._rInterval = null
    this._eInterval = null
    kad.Node.call(this, params);

  }

  inherits(Node, kad.Node);
  Node.prototype._startExpirationInterval = function () {
    this.eInterval = setInterval(this._expire.bind(this), kad.constants.T_EXPIRE);
  };

  Node.prototype._startReplicationInterval = function () {
    this.rInterval = setInterval(this._replicate.bind(this), kad.constants.T_REPLICATE);
  };

  Node.prototype.close = function (cb) {
    clearInterval(this.rInterval)
    clearInterval(this.eInterval)
    this.disconnect(cb)
  }

  function Contact(params) {
    if (!(this instanceof Contact)) return new Contact(params);
    if (util.isString(params)) {
      var u = url.parse(params)
      this.id = u.auth
      this.addrs = [params]
    }
    else if (Array.isArray(params)) {
      this.id = url.parse(params[0]).auth
      this.addrs = params
    }
    else {
      this.id = params.id
      this.addrs = params.addrs
    }

    kad.Contact.call(this, {});

  }

  inherits(Contact, kad.Contact);

  Contact.prototype._createNodeID = function () {
    return kad.utils.createID(this.id, api.config.info.encoding)
  };

  function Transport(api, addrs) {
    if (!(this instanceof Transport)) {
      return new Transport(api, addrs);
    }
    this.protoNames = api.swarm.protoNames()
    kad.RPC.call(this, Contact(addrs), api.config.kad || {});
  }

  inherits(Transport, kad.RPC);

  Transport.prototype.connect = function (addr, cb) {
    var self = this
    if (api.swarm === null) return
    var peerID = url.parse(addr).auth

    var c = 0

    for (var i in api.swarm.connections) {
      var conn = api.swarm.connections[i]
      if (peerID === conn.peerID) return cb(null, conn)
      if (conn.ping === true)++c
    }

    api.swarm.connect(addr, { ping: false }, function (err, con) {
      cb(err, con)
    })

  }

  Transport.prototype._open = function (ready) {
    ready(null)
  };

  Transport.prototype._send = function (data, contact) {
    var self = this
    var retry = 3;

    var connect = function () {
      retry--
      var addrs = contact.addrs.slice(0).filter(function (addr) {
        return self.protoNames.indexOf(url.parse(addr).protocol) !== -1
      }).sort(function sortFunc(a, b) {
        var sortingArr = self.protoNames;
        return sortingArr.indexOf(url.parse(a[1]).protocol) - sortingArr.indexOf(url.parse(b[1]).protocol);
      })

      self.connect(addrs.shift(), function cb(err, con) {
        if (addrs.length > 0 && err != null) return self.connect(addrs.shift(), cb)
        if (err != null && retry > 0) return connect()
        if (err != null) return console.log(err)
        _([data], con.peer.kad.write())
      })
    }

    connect()
  };

  Transport.prototype._close = function () {}

  var node

  return {
    name: 'kad',
    manifest: mdm.manifest(doc),
    write: function (data) {
      return _.drain(node._rpc.receive.bind(node._rpc), function () { })
    },
    put: function (key, value) {
      if (node == null) throw new Error('Service unavailable')
      node.put(key, value)
    },
    get: function (key, cb) {
      if (node == null) return cb(new Error('Service unavailable'))
      node.get(key, cb)
    },
    subscribe: function (topic, cb) {
      if (node == null) throw new Error('Service unavailable')
      node.topics.subscribe(topic, cb)
    },
    publish: function (topic, msg) {
      if (node == null) throw new Error('Service unavailable')
      node.topics.publish(topic, msg)
    },
    start: function (cb) {
      var events = api.swarm.events()
      _(events, api.swarm.on({
        ready: function (e) {
          var transport = Transport(api, e.address)
          var logger = new kad.Logger(0, 'kad:')
          var router = new kad.Router({
            transport: transport,
            logger: logger
          });

          var topics = new Quasar(router);
          node = new Node({ router: router, logger: logger, transport: transport, storage: kad.storage.FS('./tmp') })
          node.topics = topics
          cb()
          delete cb

          if (Array.isArray(api.config.bootstrap) && api.config.bootstrap.length > 0)
            node.connect(api.config.bootstrap, function (err) { });

          events.end()
        },
        end: function (err) {
          if (cb) cb(err)
        }
      })
      )
    },
    stop: function (cb) {
      node.close(cb)
    }
  }
}