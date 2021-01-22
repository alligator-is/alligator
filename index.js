const { _, Local } = require("icebreaker-rpc")

const api = {}

api.actions = Local()

module.exports={Action:require("./lib/action"),api:api,_:_}