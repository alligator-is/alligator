#!/usr/bin/env node

var address = require('network-address')
var ms = require('ms')
var home = require('osenv').home
var name = process.env.alligator_appname || 'alligator'
var path = require('path')
var Peer = require('./')

var config = require('rc')(name, {
  listen: [
    'shs+tcp://[' + address.ipv4() + ']:4239',
    'shs+ws://[' + address.ipv4() + ']:4238'
  ], path: path.join(home(), '.' + name)
})

config.info = require('./peerInfo').loadOrCreateSync(path.join(config.path, 'peerInfo'))

var peer = new Peer(config)
peer.start()

process.on("SIGINT", peer.stop.bind(peer))
process.on("SIGHUP", peer.stop.bind(peer))
process.on('SIGUSR2', peer.stop.bind(peer, peer.start.bind(peer)))