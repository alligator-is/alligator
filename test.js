var ms = require('ms')
var test = require('tape')
var Peer = require('./')
var peers = []
var os = require('os')
var address = require('network-address')
var ms = require('ms')
var home = require('osenv').home
var name = process.env.alligator_appname || 'alligator'
var path = require('path')
var Peer = require('./')
var start = 20

test('start Peers', function (t) {
  t.plan(start)

  var last = 0
  var firstPeer = null

  for (var i = 0; i < start; i++) {

    var config = require('rc')(name, {
      logLevel: 6,
      listen: [
        'shs+tcp://[' + address.ipv6() + ']:' + (4208 + i + last)
      ], path: path.join(home(), '.' + name),
      bootstrap: firstPeer == null ? [] : ['shs+tcp://' + firstPeer.id + '@[' + address.ipv6() + ']:4208']
    })

    var mkdirp = require('mkdirp')
    mkdirp.sync(config.path)
    config.info = require('./lib/peerInfo').loadOrCreateSync(path.join(config.path, 'peerInfo-' + i))

    var peer = new Peer(config)
    if (i === 0) firstPeer = peer

    if (i === 0) firstPeer = peer
    peers.push(peer)
    peer.start(function (err) {
      t.notOk(err)
    })

    last += 1
  }

})

test('stop Peers', function (t) {
  t.plan(start)
  setTimeout(function () {
    var i = 0
    peers.forEach(function (p) {
      p.stop(function (e) {
        t.notOk(e)
      })
    })
  }, ms('3m'))
})

