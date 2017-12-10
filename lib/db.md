## usage: async
returns usage information for db api

## ls: source
source stream that reads the data of db.

```bash
ls [--live, --limit,--since]
```

```js
ls({live:true,limit:100,since:now})
```
- opts
  - live: when live is true, it will emit change events for all future changes until aborted
  - limit:(default=100) batch limit
  - since: (default=now) start read after the given sequence 

## read: async
stop the api

