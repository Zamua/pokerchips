# pokerchips: contributor guide

Read this before doing substantive work on the project. It captures the
conventions we've agreed on and the workflow that keeps the repo
coherent over time. Read [`docs/SPEC.md`](docs/SPEC.md) next for what
pokerchips actually does.

## Workflow

### Spec-first, always

Before any code change that adds or alters product behavior:

1. Open [`docs/SPEC.md`](docs/SPEC.md).
2. Confirm the spec already describes what you're about to build. If
   not, edit the spec first, re-read it, confirm it still hangs
   together as a whole.
3. Then write the code.

In a single commit, the spec should reflect the behavior the code in
that commit implements: not what existed before, not what we plan
next. This means SPEC.md is never stale relative to code, by
construction.

### Implementation discipline: DDD + TDD

**Domain-Driven Design.** Organize packages by *bounded context*, not
by technical layer.

- The domain layer (`domain/`) holds pure types and rules. No I/O, no
  global state, no clock or randomness that is not passed in.
- Adapters (`worker/`, the client's `net/`) depend on the domain. The
  domain never depends back.
- The application service (`app/`) runs use cases by composing the
  domain with adapters through small ports.
- Don't reach for fancy DDD patterns (aggregates with events, sagas,
  unit-of-work) unless a concrete use case forces them. The shape
  (domain pure, infrastructure separate, services on top) is what matters.

**Test-Driven Development.** Tests are part of the same change as the
code they cover, not a follow-up.

- For new behavior: red → green → refactor. Write the failing test
  that pins the spec'd behavior, make it pass, clean up.
- For modifying existing behavior: write a characterization test that
  pins the *current* behavior first, then change the code + the test
  together.
- Prefer integration tests over unit tests where the boundary is real
  (a real Durable Object, real WebSockets, two real browsers). Reserve
  unit tests for pure logic where there's nothing to integrate.

### Commits

Conventional Commits style, single line. No co-author trailers, no
agent-attribution lines. Examples:

```
feat(domain): split a pot evenly among chosen seats
fix(worker): answer a refused frame with its op
test(client): pin the reconnect backoff cap
docs(spec): clarify who may undo an entry
```

## Repo layout

```
domain/       the Table aggregate, ledger entries, values, version 2 import; pure
protocol/     frames and the table view shared by the Worker and the client
app/          TableService and its ports (store, publisher, clock, secrets)
worker/       Worker entry, TableCell (the Durable Object), SQLite store
client/       React app (Vite): screens, drawers, socket lifecycle, e2e
docs/         SPEC.md (behavior), ARCHITECTURE.md (code), design/ (the mockup)
scripts/      smoke.mjs, the post-deploy smoke test
```

Imports point down: client and worker may import protocol and domain; app
imports domain and protocol; domain imports nothing.

## Local setup

Node 22 or newer. npm blocks package install scripts unless `allowScripts`
in package.json lists them (esbuild and workerd are listed).

```
npm install
make worker      # wrangler dev on 127.0.0.1:8787
make dev         # Vite on 5173, proxying /api to 8787
make test        # vitest: unit project and worker project
make typecheck
make e2e         # needs PLAYWRIGHT_BROWSERS_PATH pointing at installed browsers
```

The worker tests run in workerd through `@cloudflare/vitest-plugin`, with a
real Durable Object and real WebSockets.

## Deploy

This repo ships application code, `make build` and `make smoke` only. The
Worker names, routes and allowed origins of real deployments live with the
operator, outside the repository.

## Don'ts

- Don't commit environment-specific paths, IPs, hostnames, account
  IDs, or operator credentials. The repo is meant to be a clean
  implementation that anyone can clone and run.
- Don't add personal preferences or session-specific notes here.
  Those belong in your local (untracked) config.
- Don't bypass the spec-first rule. If a fix is "too small to spec,"
  it's either small enough that the spec was already correct, or it
  changes behavior and the spec needed updating. Either way: read
  the spec before the change.
