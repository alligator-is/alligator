module.exports = function(api){
    return {
        path:"test",
        manifest:{"hello":"async"},
        hello:function(cb){
            cb(null,"world")
        }
    }
}