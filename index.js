const _ = require('icebreaker-rpc')._

const api = {}

_.events = ()=>{
    const notify = _.notify()
    let queue = []
    return {
        emit:(event)=>{
            if(queue)return queue.push(event)
            notify(event)
        },
        listen:()=>{
            const source = notify.listen()
            if(queue){
                queue.forEach(notify)
                queue = null
            }
          
            return source
        },
        end:notify.end
    }
}

module.exports={Action:require("./lib/action"),api:api,_:_}