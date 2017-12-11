## usage: async
Returns usage information of db api

## ls: source
Source stream that reads the data of db.

```bash
ls [--live=100, --limit,--since]
```

```js
ls({live:true,limit:100,since:now})
```

- opts
  - live: when live is true, it will emit change events for all future changes until aborted
  - limit:(default=100) batch limit
  - since: (default=now) start read after the given sequence 

## read: async
The connected remote peer reads the local db and writes it to remote db.