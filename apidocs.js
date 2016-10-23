var fs = require('fs') 
module.exports={
    kad:fs.readFileSync(__dirname + '/kad.md', 'utf-8'),
    swarm:fs.readFileSync(__dirname + '/swarm.md', 'utf-8')


}