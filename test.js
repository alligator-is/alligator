var ms = require('ms')
var test = require('tape')
var Peer = require('./')
var api = new Peer({
  listen: [
    'shs+ws://localhost:3332',
    'shs+tcp://localhost:3334',
    'shs+utp://localhost:3436'
  ],
  bootstrap: [],
  swim: {
    host: '127.0.0.1',
    port: 3959,
    codec: 'json'
  }
})

var peers = [api]
test('start Peers', function (t) {
  t.plan(31)
  api.start(function (err) {
    t.notOk(err)
  })

  var last = 0

  for (var i = 0; i < 30; i++) {

    var peer = new Peer({
      timeout: ms('20s'),
      listen: [
        'shs+ws://localhost:' + (4237 + i + last),
        'shs+tcp://localhost:' + (4237 + i + 1 + last),
        'shs+utp://localhost:' + (4237 + i + 2 + last)
      ],
      kad: {
        timeout: ms
      },
      bootstrap: ['shs+utp://' + api.swarm.peerID + '@localhost:3436'],
    })
    peers.push(peer)
    setTimeout(peer.start.bind(peer, function (err) {
      console.log('started')
      t.notOk(err)

    }), i * 300)


    last += 4
  }
})

test('stop Peers', function (t) {
  t.plan(31)
  peers.forEach(function (p) {
    p.stop(function (e) {
      t.notOk(e)
    })
  })
})