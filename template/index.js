const { api, Action } = require("alligator")

module.exports = () => {

  api.actions.echo = Action({
    type: "async",
    description: "returns a echo",
    input: "string",
    defaults: "hello world",
    run: (str, cb) => {
      return cb(null, str)
    }
  })
  
}