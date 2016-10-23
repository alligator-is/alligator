var ms = require('ms')
var test = require('tape')

var Peer = require('./')

var peers = []

test('start Peers', function (t) {
  t.plan(31)

  var last = 0
  var firstPeer = null
 
  for (var i = 0; i < 31; i++) {

    var peer = new Peer({
      timeout: ms('20s'),
      listen: [
        'shs+ws://localhost:' + (4237 + i + last),
        'shs+tcp://localhost:' + (4237 + i + 1 + last),
        'shs+utp://localhost:' + (4237 + i + 2 + last)
      ],
      bootstrap: firstPeer == null ? [] : [firstPeer.util.isWindows() ? 'shs+tcp://' + firstPeer.id + '@localhost:4237' : 'shs+utp://' + firstPeer.id + '@localhost:4237'],
    })

    if (i === 0) firstPeer = peer
    
    peers.push(peer)
    
    setTimeout(peer.start.bind(peer, function (err) {
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