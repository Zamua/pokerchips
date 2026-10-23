# Architecture

pokerchips is one Cloudflare Worker. The Worker serves the client app and
routes each table's traffic to that table's Durable Object, the actor that
owns the table: it applies commands one at a time, keeps the table in its own
SQLite storage, and holds the table's WebSockets. There is no other server
and no shared database; two tables never touch.

```
browser ──HTTPS/WSS──▶ Worker (routes, origin check, static assets)
                          │ idFromName(code)
                          ▼
                     TableCell (Durable Object, one per table)
                       ├─ application: TableService
                       ├─ domain:      Table aggregate, ledger, rules
                       └─ adapters:    SQLite repository, socket hub, clock
```

## Layers

Code is organised by layer inside one bounded context, the table. Imports
only point downward.

| Layer | Directory | Holds | May import |
| --- | --- | --- | --- |
| Domain | `domain/` | The `Table` aggregate, value objects (`TableCode`, `SeatName`, `Chips`, `PotId`), ledger entries, the rules of every command, error codes. Pure functions over plain data. | nothing |
| Protocol | `protocol/` | Frame and state types shared by the Worker and the client, and the parser that turns untrusted JSON into typed frames. | `domain/` |
| Application | `app/` | `TableService`: load the table, run a domain command, persist the entry, publish the new state. Ports it needs: `TableStore`, `Publisher`, `Clock`, `Random`. | `domain/`, `protocol/` |
| Adapters | `worker/` | The Worker entry, `TableCell`, the SQLite `TableStore`, the hibernating-socket `Publisher`, rate limiting, the expiry alarm. | everything above |
| Client | `client/` | The React app: screens, the drawer, the socket lifecycle, recent tables, the landing's chip toy. | `protocol/`, `domain/` (for formatting and client-side checks only) |

The domain decides; it never does I/O, reads the clock or makes randomness.
Time and ids come in as arguments. A command returns either the entries to
append or an error code, so every rule is a plain unit test.

Cross-cutting concerns stay out of the domain and the service: origin
checks, rate limits and logging wrap them at the Worker and the cell.

The landing's chip toy follows the same split inside the client: `ui/toy.ts`
holds its rules (where chips rest, what a tap does, where a dropped chip
settles), `ui/toyWorld.ts` adapts them to matter-js and is loaded on demand
in its own chunk, and `ui/ChipToy.tsx` draws the chips and handles pointers.
Betting with chips has the same three parts: `table/betChips.ts` (the bet as
chips, the tray, making change), `table/feltWorld.ts` (the felt's physics, on
demand) and `table/ChipBet.tsx` with `table/feltScene.ts` (the felt, the tray,
and the chips flying between them).

## The table actor

- **One writer.** A Durable Object runs one request at a time between awaits,
  and `TableService` makes no outbound call while a command runs, so a
  command reads and writes the table with nothing interleaving.
- **Storage.** SQLite tables `state` (the table as one JSON row), `ledger`
  (append-only) and `answers` (the last 64 answers per seat, for repeated
  `op` ids, indexed by seat and answer number so finding the newest and
  pruning the oldest are range seeks). A command's table, entries and answer
  commit in one transaction, about five rows written. The store keeps the
  table and the newest 50 ledger entries in memory, following each commit, so
  a command reads about five rows whatever the ledger's length; an actor
  woken from hibernation reads them once.
- **Sockets.** The WebSocket Hibernation API: a socket's attachment records
  its seat once `hello` succeeds, so presence is "any open socket holding
  this seat". `ping` is an auto-response and never wakes the table.
- **Expiry.** An alarm set 30 days after the last activity deletes the
  table's storage when it fires and no socket is open.

## Moving from version 2

`TableCell` also answers `POST /import` with one version 2 room. The Worker
never forwards that path, so only code holding the `TABLES` binding reaches
it: the operator's migration Worker, which has no route. An import lands only
in a table that does not exist yet.

## Tests

- `domain/`: unit tests of every rule, invariant and error code (Vitest).
- `app/` and `worker/`: integration tests against a real Durable Object and
  real WebSockets under `@cloudflare/vitest-plugin`: two clients, races
  on one pot, repeated `op` ids, reconnects, expiry.
- `client/`: unit tests for the socket lifecycle, the state reducer and the
  chip toy's rules, and a Playwright suite that drives two players through a
  hand, and the chip toy, on phone-sized Chromium and WebKit.

## Deploy contract

`wrangler.jsonc` in this repo runs the app locally (`wrangler dev`). The
staging and production configs (Worker names, routes, the allowed origins)
live with the operator, outside this repository.
