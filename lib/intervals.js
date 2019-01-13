
class Intervals {
    constructor() {
      this.timers = {}
      this.closing = false
    }
  
    start(id, func, time) {
      if (this.closing) return
      if (this.timers[id]) this.stop(id)
      const self = this
      this.timers[id] = setInterval(() => {
        if (self.closing == true) return self.stop(id)
        func()
      }, time)
    }
    stop(id) {
      if (this.timers[id]) {
        clearInterval(this.timers[id])
        delete this.timers[id]
      }
    }
  
    stopAll() {
      this.closing = true
      for (var t in Object.keys(this.timers)) {
        if (this.timers[t]) {
          clearInterval(this.timers[t])
          delete this.timers[t]
        }
      }
    }
  }
  module.exports = Intervals