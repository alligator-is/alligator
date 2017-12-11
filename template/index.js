module.exports = function(api){
    var md  = api.manifest("./index.md", __filename)
    return {
        path:"test",
        manifest:md.manifest(),
        usage:md.usage,
        hello:function(cb){
            cb(null,"world")
        }
    }
}