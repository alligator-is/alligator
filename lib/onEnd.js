  
   module.exports=function onEnd(params, cb) {
    const source = params.source, sink = params.sink
    let ended = false, _ended = false
  
    var del = function () {
        if (ended === true && _ended === true) {
        if(cb)cb()
          delete cb
      }
    }

    params.source = function (end, cb) {
        source(end, function (end, data) {
            if (end) ended = true
            cb(end, data)
            if (end && del) del()
        })
    }

    params.sink = function (read) {
        sink(function (abort, cb) {
            if (abort) {
                _ended = true
                if (del) del()
                return read(abort, cb)
            }
            read(abort, function (end, data) {
                cb(end, data)
                if (end) _ended = true
                if (end && del) del()
            })
        })
    }

 
    return params
  }