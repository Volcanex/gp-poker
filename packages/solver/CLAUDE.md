# @opentable/solver

Real time CFR+ over one street of a heads-up subgame, and the range tracking
that decides what to hand it. This is what level 6 plays on
(`server/src/bots/`); nothing else uses it yet.

Pure and isomorphic. It imports `@opentable/preflop` (for the charts and the
equity ranking) and `phe` (to evaluate a hand), and nothing from node, so it
runs unchanged on the server, in a script and in a browser worker.

## What it is not

- **Not GTO.** It solves the street in front of it, against a bet size set of
  four or five options, from ranges it guessed. A real solve is the whole game
  tree from the deal with no abstraction, and it is not something this box can
  do in a second.
- **Not a preflop solver.** Preflop is the heuristic charts in
  `@opentable/preflop`, read with mixed frequencies at the boundaries. Solving
  preflop properly means solving everything behind it.
- **Not purely an equilibrium either.** It deviates in one place, deliberately,
  and the place is documented below. An unmodified solve loses to level 5,
  because equilibrium bluffs are made to keep a balanced opponent indifferent
  and none of this site's other bots is balanced.

## The pieces

- `cards.ts` - card indices, the dense 1326 combo numbering, blocking masks.
  A card index is `rank * 4 + suit` over `'23456789TJQKA'` and `'shdc'`, which
  is byte for byte what `phe` calls a card code, so an index is handed to the
  evaluator unchanged.
- `range.ts` - a range is `Float32Array(1326)` of weights, built from a chart's
  percentile regions with the edges tapered so a boundary is a mix rather than
  a cliff.
- `showdown.ts` - the terminal values. **The sorted sweep is the load bearing
  idea in this package:** both ranges are ranked once per board, and each
  evaluation walks the ranking once carrying a running total of opponent weight
  plus a per card total, so "the weight of the hands I beat that share no card
  with mine" comes out in constant time per combo. That turns every terminal
  from O(n squared) into O(n), and it is why a river solve is milliseconds
  rather than seconds.
- `tree.ts` - the public betting tree of one street. Check plus three bet sizes
  plus all-in when first in; fold, call, one raise size plus all-in when facing
  one; two raises a street. A dozen to twenty decision nodes. **All-in is only
  offered on the flop and the turn while what is behind is at most four times
  the pot**: deep on an early street the value of a stack-off comes almost
  entirely from the depth limited leaf, which is the least trustworthy thing
  here, and a solver that trusts it puts a hundred big blinds in with top pair.
  On the river, where the solve is exact, the option is always there.
- `cfr.ts` - CFR+ with linear averaging, one traversal per player per
  iteration, vectors from a bump allocator. `exploitability()` runs a best
  response for each player against the average strategy and is what the numbers
  below are measured with.
- `solve.ts` - puts them together. The river is exact. The turn and the flop
  are **depth limited**: when the street closes without a fold the hand is
  worth its share of the pot at showdown, averaged over the cards still to
  come, and no further betting is modelled. That leaf is then discounted (0.85
  on the turn, 0.72 on the flop), because a medium hand does not realise its
  raw equity against further betting: it pays off the top of a range and folds
  to the rest. Discounting the leaf makes winning the pot now worth relatively
  more than winning it at showdown, which is the shape of the error, and it
  stays zero sum because both sides scale together.
- `opponent.ts` - ranges through a hand. Preflop is a chart read of the line;
  postflop each of their actions leans the range by made hand strength on the
  board, sharpened by how big the wager was and sharpest for a raise, and
  damped against the range as it stood rather than against the population, so
  a read that has already narrowed twice is not handed back.
- `bot.ts` - `SolverBot.decide(view, rng, runner, budgetMs)`: the same
  `TableView` a browser gets in, one action or null out. Null means the spot is
  not one it plays and the caller should ask an older level. It also holds the
  two things that are not the solve: the statistics kept on an opponent, and
  the shaping applied to what comes back.

## Sizes and budgets

| | combos | decision nodes | leaf |
|---|---|---|---|
| river | 400 to 600 | ~12 | exact showdown |
| turn | 400 to 600 | ~18 | 8 of 48 river cards per iteration |
| flop | 400 to 1000 | ~20 | 8 of 96 sampled two card runouts per iteration |

Exploitability, as a share of the pot the street started with, measured with
`packages/solver/scripts/bench.ts` on `Ah Kd 7c 2s 9h` and its prefixes with
ranges of 30% and 45%. It is measured **inside the tree the solver builds and
against the leaf it optimised**, so it says the solve converged, not that the
bet size set is complete or that the leaf is right. Turn and flop are measured
against every runout there is rather than against the sample the solve trained
on.

| budget | river | turn | flop |
|---|---|---|---|
| 300ms | 0.08% | 1.33% | |
| 500ms | 0.03% | 0.99% | 1.31% |
| 1000ms | 0.01% | 0.51% | 0.73% |
| 1500ms | | 0.43% | 0.69% |

Measured 2026-09-09 on h while other work was running, so the iteration counts
are lower than a quiet box would give and the numbers are a floor. The river is
solved to a hundredth of a percent of the pot in half a second. The turn and
the flop keep improving with time but flatten out: what is left is the depth
limited leaf, not the iteration count. Buying that back means solving the river
subgames underneath the turn rather than valuing them by equity, which costs
about two orders of magnitude.

## Nothing blocks for long

Level 6 runs on the server's main thread in slices (see
`server/src/bots/CLAUDE.md` for why it is not a worker). The contract that
makes that safe lives here: **the longest thing this package does without
returning is one CFR iteration**, a couple of milliseconds. The part that was
not incremental, ranking every runout of a depth limited leaf, ranks four per
iteration instead and sweeps whatever is ready. Early iterations therefore see
a coarser leaf than late ones, which CFR+ already discounts by weighting the
average strategy linearly.

Anything added here has to keep that property or level 6 starts stalling
websockets.

## Rerunning the numbers

```
npx tsx packages/solver/scripts/bench.ts     # convergence and timing
npx vitest run packages/solver               # correctness
```

The correctness test worth knowing about is the clairvoyance game: hero holds
either the nuts or nothing, villain holds a hand between them, one pot sized
all-in is the only bet. The answer is arithmetic rather than numerical (a third
of the bets are bluffs, villain calls half the time), so it pins the regret
matching itself rather than only its convergence.

## Gotchas

- `phe` ranks are lower-is-better, and handing it the same card twice reads off
  the end of its tables rather than throwing. A universe built on the flop
  still holds combos that use a card the runout has since dealt; `rankBoard`
  ranks those worse than any real hand and the leaf drops them from both sides
  at once, which is what keeps the subgame zero sum. Break that and
  `exploitability()` goes negative, which is the tell.
- A range is never allowed to reach zero everywhere. `widen` puts a floor under
  it, and every postflop filter is blended back towards a population prior. A
  bot that has narrowed its opponent to nothing folds the nuts.
- The strength filter reads the board as it stands, so it treats a flush draw
  as the eight high it currently is. That is the largest error in the range
  tracking and the reason the prior blend is as heavy as a quarter.
