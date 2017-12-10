var path = require("path")
var mdm = require('mdmanifest')
var fs = require("fs")
var _ = require("icebreaker")

module.exports = function (filename, p) {
    var docs = path.dirname(fs.realpathSync(p || __filename))
    var doc = fs.readFileSync(path.join(docs, filename)).toString()

    return {
        usage: function (opts, cb) {

            if (_.isFunction(opts)) {
                cb = opts
                opts = {}
            }
            if (!opts) opts = {}
            if (typeof opts == "string") opts.command = opts

            var command = opts.command
            if (command == opts.prefix) command = null
            if (!_.isFunction(cb)) return mdm.usage(doc, command, opts)
            cb(null, mdm.usage(doc, command, opts))
        },
        manifest: mdm.manifest.bind(null, doc),
        html: mdm.html.bind(doc)
    }
}