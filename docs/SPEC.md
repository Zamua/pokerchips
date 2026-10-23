# pokerchips: product spec

A chip tracker for an in-person poker night. Someone opens a table, shares
its 8-character code, everyone joins on their phone, and the app keeps every
stack and pot. No cards are dealt: pokerchips is the bookkeeping half of the
game.

This document is the contract for version 3, a rewrite on Cloudflare Workers
with one Durable Object per table. It describes observable behavior: every
rule, every message, every state a player can see. `docs/ARCHITECTURE.md`
describes how the code is laid out. "Changes from version 2" lists every
deliberate difference from the previous Node server.

---

## Concepts

- **Table.** One game, addressed by its code. It holds seats, pots and a
  ledger. A table lives until it has been idle for 30 days.
- **Seat.** A player at the table: a name and a stack. A seat belongs to
  whoever holds its seat key.
- **Stack.** The chips in front of a seat.
- **Pot.** Chips in the middle. The main pot always exists; the host can open
  side pots.
- **Ledger.** The table's history: every change to a stack or a pot is one
  entry, in order. The state shown to players is the result of the ledger.
- **Host.** The seat that opened the table, or the seat the host handed the
  role to. The host has a few extra powers (below).

## Identifiers and values

| Value | Rule |
| --- | --- |
| Table code | 8 characters, `[a-z0-9]`, lowercased on input. Random, retried on collision. |
| Seat id | Random, 16 hex characters. Public. |
| Seat key | Random, 32 hex characters. Secret: the holder controls the seat. Stored only as a SHA-256 hash. |
| Seat name | 1 to 20 characters of letters, digits, spaces and `-_'.`, trimmed. Unique per table, ignoring case. |
| Pot id | `main`, or `side-<n>` with `n` from a counter that only grows. |
| Chips | An integer from 0 to 2^53 - 1. |
| Buy-in | An integer from 1 to 1,000,000. Default 1,000. |

A value outside its rule is refused with a typed error code (see "Errors").

## Invariants

1. No stack and no pot is ever negative.
2. Chips move; they are not created or destroyed, except by an `adjust`
   (a buy-in, rebuy, cash-out or correction) or a host `clear`, each of which
   is its own ledger entry. So the sum of stacks and pots always equals the
   sum of every adjust minus every clear (for a table moved from version 2,
   plus the stacks and pots it arrived with).
3. Every change is one ledger entry and is applied whole or not at all.
4. Commands on a table are applied one at a time, in the order the table
   receives them. Two players taking the same pot at once cannot both get it:
   the second is refused.

## Commands

Every command acts as one seat (the caller's) and either appends one ledger
entry and answers with its sequence number, or is refused with an error code
and changes nothing.

| Command | Who | Effect |
| --- | --- | --- |
| `bet { pot, amount }` | any seat | Moves `amount` (1 to the seat's stack) from the caller's stack into the pot. |
| `collect { pot, amount? }` | any seat | Moves `amount` (default: the whole pot; 1 to the pot) from the pot to the caller's stack. |
| `split { pot, seats[] }` | any seat | Divides the whole pot evenly among 2 to 24 distinct seats; leftover chips go one each to the listed seats in order. |
| `adjust { seat?, delta, reason }` | any seat for itself; the host for any seat | Adds `delta` (non-zero, signed) to a stack. `reason` is `rebuy`, `cashout` or `correction` (the table itself writes `buyin` for a new seat). Refused if the stack would go negative. |
| `undo { seq }` | the entry's author, or the host | Reverses entry `seq` (see "Undo"). |
| `openPot` | host | Opens a side pot, `side-<n>`. At most 8 side pots. |
| `closePot { pot }` | host | Closes a side pot; any chips in it move to the main pot. The main pot cannot close. |
| `clear` | host | Empties every pot; the chips leave play. For a hand abandoned in confusion. |
| `handOver { seat }` | host | Makes another seat the host. |
| `claimHost` | any seat, while the host has been away 10 minutes | Makes the caller the host. |
| `remove { seat }` | host | Removes an away seat. A non-empty stack is cashed out first, as its own entry. The host cannot remove itself. |

A new seat's buy-in is an `adjust` entry. Claiming a seat and removing one
add a `note` entry; presence is not in the ledger.

### Undo

- Only the most recent chip entry (a `bet`, `collect`, `split`, `adjust` or
  `clear`) can be undone, and only while no later chip entry exists.
- The author of that entry or the host may undo it.
- An undo is itself an entry that reverses the original exactly, so the
  ledger stays append-only. An undo cannot be undone.
- The state tells every client which entry is undoable now, so the button
  shows only where it would work.

## Seats, identity and presence

- **Opening a table** creates the table and the host's seat with the buy-in
  as its stack (an `adjust` of reason `buyin`), and returns the seat key.
- **Joining** with a new name creates a seat with the buy-in and returns its
  seat key. The table holds at most 24 seats.
- **Claiming by name.** Joining with the name of a seat that is away hands
  that seat to the caller with a new seat key; the old key stops working.
  This keeps "I switched phones" working with nothing but the code. Joining
  with the name of a seat that is here is refused (`name-taken`).
- **Here and away.** A seat is here while at least one connection holds its
  key, and away from the moment its last connection closes. The state shows
  `awaySince` for an away seat. The table's code is the credential: anyone
  with it can join, as in version 2.
- A client keeps each table's seat key on the device, so reopening the table
  goes straight back to the seat.

## Protocol

### HTTP

| Request | Answer |
| --- | --- |
| `POST /api/tables` `{ name, buyIn? }` | 201 `{ code, seatId, seatKey }` |
| `GET /api/tables/<code>` | 200 `{ code, seats: [{ name, here }] }`, or 404 |
| `POST /api/tables/<code>/seats` `{ name }` | 201 `{ seatId, seatKey }`; 404; 409 `name-taken` or `table-full` |
| `GET /api/tables/<code>/socket` (WebSocket upgrade) | 101; for a table that does not exist the socket answers `denied` with `not-found` and closes |
| `GET /healthz` | 200 `ok` |

A request whose `Origin` is not on the allowed list is refused with 403.
Everything else is the client app; any other path serves it, so
`pokerchips.app/<code>` opens that table.

### WebSocket

Every frame is one JSON object with a `t` field.

Client to table:

| Frame | Meaning |
| --- | --- |
| `{ t: "hello", seatKey }` | Must be first. Answered by `welcome` or `denied`. |
| `{ t: "cmd", op, cmd: { type, ... } }` | A command. `op` is a client-made id; a repeated `op` from the same seat is answered with the first answer again and not applied twice, so a client may resend after a reconnect. |
| `{ t: "history", before }` | Asks for up to 50 ledger entries older than `before`. |
| `{ t: "ping" }` | Answered `{ t: "pong" }` without waking the table. |

Table to client:

| Frame | Meaning |
| --- | --- |
| `{ t: "welcome", seatId, state }` | The caller holds this seat; the full state follows. |
| `{ t: "denied", code }` | The seat key is unknown or revoked. The socket closes. |
| `{ t: "state", state }` | Sent to every socket after every change. |
| `{ t: "ack", op, seq }` / `{ t: "nack", op, code }` | The answer to one command. |
| `{ t: "history", entries }` | The answer to `history`. |

`state` is the whole visible table:

```
{
  code, createdAt, buyIn, seq,          // seq: the last ledger entry
  host: <seatId>,
  seats:  [{ id, name, stack, here, awaySince }],
  pots:   [{ id, amount }],
  ledger: [<the newest 50 entries>],
  undoable: <seq> | null
}
```

A ledger entry is `{ seq, at, by, kind, ... }` with the fields of its kind
(`bet`, `collect`, `split`, `adjust`, `undo`, `clear`, `openPot`,
`closePot`, `handOver`, `note`). Clients render its text.

A socket may send at most 10 frames a second; extra frames are answered
`nack` with `rate-limited` and dropped. A refused frame's `nack` carries its
`op` whenever the frame is JSON with a valid `op`, and `""` otherwise.

### Errors

Stable codes, each shown to the player as a sentence by the client:
`bad-name`, `bad-amount`, `bad-code`, `not-found`, `name-taken`,
`table-full`, `not-host`, `no-such-seat`, `no-such-pot`, `short-stack`, `short-pot`,
`too-many-pots`, `main-pot`, `not-undoable`, `host-here`,
`not-away`, `rate-limited`, `bad-frame`.

## Client

- **Connection.** The client pings every 25 seconds, reconnects with
  exponential backoff (500 ms doubling to 30 s, 50 to 100% jitter), reconnects
  at once when the app returns to the foreground, and holds commands made
  while disconnected (up to 100) to send after the next `welcome`. A
  connection indicator shows connected, reconnecting, or offline.
- **Screens.** Landing (open a table, join with a code, recent tables),
  open-a-table (name, buy-in presets 500, 1,000, 2,000, 5,000, 10,000 or a
  custom amount), join (code, name, and one-tap claim of an away seat), and
  the table.
- **The landing chips** are a toy with physics: a tap topples a stack (or
  flips a loose chip), any chip can be dragged and thrown, and a chip dropped
  over a stack settles on top of it. Once the chips are disturbed a Restack
  button appears that puts every chip back where it started. With reduced
  motion the chips stay still.
- **The table screen** shows the caller's stack largest, the pots, every
  other seat with its stack and badges (YOU, HOST, AWAY), and the newest
  ledger entries with Undo where `undoable` allows. A sticky action bar holds
  Bet, Win (collect or split) and More (rebuy or adjust, players, history,
  share, leave).
- **Entering amounts** happens in a bottom drawer: the pot, quick chips
  derived from the buy-in, All-in, a large readout, a keypad, and confirm.
- **Betting with chips.** The bet drawer puts your chips in a tray instead:
  one stack per quick-chip value, holding as many chips as the rest of your
  stack covers (at most nine). A tap on a stack, or a chip dragged up and let
  go over the felt, puts that chip in; the felt shows the chips in and their
  total. Undo takes back the last chip, Reset takes back all of them, and
  All-in puts in your whole stack. Type swaps the tray for the keypad, and a
  typed amount puts in the fewest chips that make it. The drawer remembers
  Chips or Type on the device. Nothing is bet until the confirm button, which
  names the total, is pressed. With reduced motion the chips appear in place.
- **Recent tables** (code, name, seat key, last opened) are kept on the
  device. Leaving a table forgets its seat key on that device; the seat stays
  at the table, away.
- **Feedback.** A chip sound and motion on bets and wins; a toast for every
  refused command, in words.

## Lifetime

A table is deleted with everything in it once it has had no connection and
no ledger entry for 30 days.

## Changes from version 2

1. A seat is held by a seat key, not by its name alone; claiming by name
   still works, for an away seat only.
2. Closing a side pot moves its chips to the main pot; version 2 dropped
   them. Resetting the pots becomes the host's `clear`, recorded in the
   ledger.
3. `adjust` is recorded in the ledger with a reason, and the host can adjust
   any seat.
4. New: `split`, `undo`, `handOver`, `claimHost`, `remove`, ledger history,
   seat and pot limits.
5. The shared lobby music is gone.
6. The protocol is new: commands carry an `op` id and get an answer each, and
   every change sends the whole state.
7. Tables from version 2 move over with their code, seats, stacks, pots,
   host and activity (as `note` entries); their seats start away and are
   claimed by name, and they expire 30 days after their last version 2
   activity. A name version 2 allowed but version 3 does not is cleaned
   (spaces collapsed, other characters dropped, 20 characters, `Player <n>`
   if nothing is left), and names equal ignoring case get ` 2`, ` 3`. A
   phone's version 2 recent tables show in Recent; opening one claims that
   seat by name.

## Non-goals

- Dealing cards, judging hands, enforcing betting rounds or blinds.
- Accounts, long-term history, leaderboards.
- Any credential beyond the table code and the seat key on a device.
