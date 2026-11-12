# pokerchips

A chip tracker for an in-person poker night. Someone opens a table, shares
its 8-character code, everyone joins on their phone, and pokerchips keeps
every stack and pot: bets, wins, split pots, side pots, rebuys and an undo
for the last move. No cards are dealt; this is the bookkeeping half of the
game.

Live at [pokerchips.app](https://pokerchips.app).

## How it works

One Cloudflare Worker serves the app and gives each table its own Durable
Object: a single actor that applies every move in order, keeps the table in
its own SQLite storage and pushes each change to every phone over a
WebSocket. Players need no account: the table code gets you in, and a seat
key kept on your phone keeps your seat. See [`docs/SPEC.md`](docs/SPEC.md)
for the rules and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
code.

## What is collected

No account, no cookie, no address kept. To count how many devices use the
app, your browser makes a random id and sends it along; the server keeps
only a keyed hash of it, with four counters: active today, table created,
game started, hand played. Nothing links it to your name, seat or table.
[`docs/SPEC.md`](docs/SPEC.md) has the details under "Usage counts".

## Run it

Node 22 or newer.

```
npm install
make worker      # the Worker and its Durable Objects on 127.0.0.1:8787
make dev         # the client with hot reload on http://localhost:5173
```

Or build the client and let the Worker serve it: `make build && make worker`,
then open http://127.0.0.1:8787.

## Test it

```
make test        # domain rules, the table actor over real WebSockets, client logic
make typecheck
make e2e         # Playwright: two phones, Chromium and WebKit
SMOKE_BASE_URL=http://127.0.0.1:8787 make smoke
```

## Deploy

`npm run build` writes the client to `client/dist`; `wrangler deploy` with a
config naming the Worker, its routes and `ALLOWED_ORIGINS` publishes both.
Usage counts are off unless the config binds an Analytics Engine dataset as
`ACTIVITY` and the Worker has an `ACTIVITY_SALT` secret.
The free Workers plan is enough.

## License

MIT
