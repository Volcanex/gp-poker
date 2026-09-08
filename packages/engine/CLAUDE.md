# engine

Pure, deterministic N-player (2..9) no-limit hold'em. No clock, no socket, no
database: every function takes a state and returns a new one. `src/types.ts` is
the contract; the implementation is split across `src/random.ts` (seeded deck),
`src/deal.ts` (posting/dealing/street advancement), `src/betting.ts`
(`legal`/`apply`), `src/showdown.ts` (side pots and hand evaluation),
`src/pots.ts` (the side-pot layer algorithm), and `src/replay.ts`.
`src/index.ts` re-exports all of it, plus the
protocol types the public functions use (`Card`, `ActionKind`, `Street`,
`LoggedAction`).

## Dealing
Two cards per seat, dealt round-robin starting left of the button (one card
to each seat in order, then the second card to each seat in the same order),
not two cards to one seat before moving on. The board is the next five
cards straight after the hole cards in deck order; there are no burn cards.

## Betting closure
Each seat has an `acted` flag meaning "does not need to act again given the
current aggression." A full bet or raise resets it to `false` for every
other seat still in the hand and not all-in; a call, check, or an all-in
that falls short of a full raise does not. The street closes when every
non-folded, non-all-in seat has `acted === true`. This alone is enough to
reproduce the big-blind option (their `acted` starts `false` and nothing
resets it early) and the "short all-in doesn't reopen the action" rule,
with no separate case-handling needed.

An 'a' (all-in) action is resolved by comparing the seat's full commit
against `currentBet`: at or below it, it behaves like a capped call; above
it, like a bet or raise (short of the minimum raise if the stack doesn't
cover one, still short-raise semantics either way).

If a seat can still act but everyone else is all-in, that seat keeps
getting a turn on every remaining street (checking it down is the practical
option, but betting into dead action is still legal). If nobody at all can
act, the engine runs the board out and resolves at showdown in one step.
This can happen at deal time (both/all posted their whole stack as blinds)
or mid-`apply` (the second of two all-ins on an earlier street).

## Showdown and pots
Side pots are built by peeling the lowest common committed amount off all
contributors (folded seats included: their chips stay in every layer they
reached) until nothing is left; a layer with no non-folded contributor
rolls forward into the next one that has one. Consecutive layers with an
identical eligible set are merged, so a hand with all-ins at the same
effective level doesn't produce redundant pot entries.

A pot's winners are its eligible seats with the best 7-card hand (`phe`,
lower rank number wins); ties split the pot evenly with any odd chip(s)
going to the first tied winner seated left of the button. A fold to one
remaining seat resolves without touching `phe` at all. The board may be
incomplete, and `shown` stays empty (`HandResult.shown`/`HandOutcome.shown`
is specifically "revealed at a real showdown", not "money changed hands").
At an actual showdown, every non-folded seat's cards go into `shown` and
every award gets a `hand` description, even for a side pot only one player
was ever eligible for.

## Gotchas
- `street` never persists as `'showdown'`. A resolved hand jumps straight
  from `'river'` (or wherever the last live action was) to `'done'` within
  the same `apply()` call. The value exists in the protocol type for the
  view layer, not because the engine stops there.
- `SeatState.bet` is "committed on the current street", and gets reset to 0
  on every street change, including inside an auto run-out. Use
  `committed` (committed for the whole hand) to sanity-check a finished
  hand's chip flow, not `bet`.
- `fold` is always in `legal().actions`, even when checking for free is
  available. The engine doesn't forbid a "bad" fold; that's a client/UX
  choice, not a rules one.
- Neither `phe` nor `pokersolver` ships type declarations; see
  `src/vendor.d.ts` for the minimal ambient types instead of pulling in
  `@types/*` packages that don't exist for either.
- `test/fuzz.test.ts` cross-checks every showdown pot against `pokersolver`
  (a second, independent evaluator) rather than re-deriving winners with
  `phe` again, which would only prove the engine agrees with itself.
