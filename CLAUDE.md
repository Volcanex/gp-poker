# opentable

**Owner:** Gabriel Penman
**What:** Open Table, free ranked heads-up no-limit hold'em at
poker.gabrielpenman.com. Lichess for poker: no money, no chips to buy, no
rake, no ads. Chips are table units that reset every match; the scarce
currency is Glicko-2 rating. Instant play as a guest, claim the account
later. Every match has a permanent public URL with hand histories, a
provably fair shuffle and preflop accuracy scoring.

## Run
systemd unit `opentable`, port 8130, `node server/dist/index.js`. nginx
vhost proxies `/` and upgrades `/ws`. Local: Postgres on 5432 (`docker
compose up -d db` if there is none), copy `.env.example` to `.env`, then
`npm install && npm run dev` (builds the client, starts the server with
tsx, serves everything on one port). Tests: `npm test` (vitest in every
workspace). Deploy on h: `npm run build && systemctl restart opentable`.
Schema in `server/db/schema.sql` is applied idempotently at start.

## Shape (npm workspaces, TypeScript end to end, Node 22)
- `packages/protocol` — wire types v1 and the per-viewer `TableView`. The
  contract between server and client; bump `PROTOCOL_VERSION` on change.
- `packages/engine` — pure NLHE engine, 2..9 seats, side pots, deterministic
  deck from a seed. `types.ts` is its public contract. Hand strength via
  `phe`; `pokersolver` is only a test-time reference evaluator.
- `packages/rating` — Glicko-2 (tau 0.75, per-match update, RD widened on
  inactivity, provisional while RD > 110) and the matchmaking pairing
  function (pure, ticked by the server).
- `packages/preflop` — cached baseline HU charts by stack depth and the
  EV-lost scorer. Preflop only, no solver at runtime.
- `server` — Fastify REST + `ws` WebSocket + `postgres` driver. Owns
  sessions, matchmaking queue, match orchestration, clocks, persistence,
  serving `client/dist`.
- `client` — React 19 + Vite + motion + number-flow. g-system vendored at
  `client/public/g/` (never hand-edited; re-vendor from the g-system repo).

## Decisions
- Rated format: heads-up, 200 units each, blinds 1/2, best-of-25 hands or
  bust; higher stack after 25 wins, equal stacks is a draw (Glicko 0.5).
  Blinds never escalate. 20s decision clock, 15s reconnect grace, three
  consecutive timeouts forfeits the match.
- Server authoritative. Clients send `act` with the hand number and action
  seq they believe they are acting at; stale or illegal actions are refused
  with `err`. Hole cards are stripped in `toView(state, viewerSeat)` on the
  server; nothing else ever serialises a `HandState`.
- Provably fair: 32-byte seed per hand, `sha256(seed)` shown before the
  deal, seed published when the hand ends. Deck = Fisher-Yates driven by
  HMAC-SHA256 counter DRBG over the seed. Verify: rehash, re-derive deck,
  compare to the recorded board and holes.
- Replay = `engine.replay(config, actions)`; the stored hand row holds
  seed, stacks, button and the action log, nothing derived is trusted.
- Auth: a guest user is minted on first visit (cookie session). Claiming
  sets a name and password on the same row so rating carries over.

## Gotchas
- g-system tokens: `--surface-1/-2`, `--bg`, `--text-primary/-secondary`,
  `--border`. There is no `--surface`.
- `phe` ranks: lower is better (1 = royal flush, 7462 = worst high card).
