# alligator
Multi Protocol RPC Gateway for node.js

[![Travis](https://img.shields.io/travis/alligator-io/alligator.svg)](https://travis-ci.org/alligator-io/alligator)
## Work in progress !!! 
## Futures:
- Establish bidirectional connections between clients through firewalls using low-level protocols TCP, WS, UTP
- Provide or call write and read actions (streams, promises, async functions).
- Central authentication and assignment of rights with groups
- Address book with all connected connections and Actions so the alligator client can provide load balancing.
- Forwards invocation of Streams Promises and Async functions to the Alligator with the connection to the desired client.
- Command line interface
### At least two connected alligator servers are required for the alligator system to work.

## Example of commands for deployment to two servers

## Server 1
```
npm install -g alligator
alligator start --logLevel 6 --listen "shs+tcp://[::]:81" --listen "shs+ws://[::]:80" 
alligator friends.put server2Id
```

## Server 2
```
npm install -g alligator
alligator start --logLevel 6 --listen "shs+tcp://[::]:81" --listen "shs+ws://[::]:80" --bootstrap "shs+ws://Server1PublicKey@IPServer1:80"
// Test command
alligator lb.groups.ls lb.addrs lb.protoNames
```

## Run client
```
npm install -g alligator
node bin run --bootstrap  "shs+ws://Server1PublicKey@IPServer1:80"
```

### The admin interface is located at http://alligator.is.

## License
MIT
