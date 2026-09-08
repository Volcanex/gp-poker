# @opentable/equity

The analysis layer: what a holding is called, how often it wins, and what
would improve it. Pure and isomorphic, so the same code runs in a node test
and in the client's web worker. Nothing here knows about a match, a socket or
a database.

## Shape
- `src/name.ts` — `handName(5..7 cards)`, e.g. "Two pair, aces and nines".
  The category comes from `phe`, the evaluator the engine settles pots with,
  so a name can never disagree with who won; the wording is derived from the
  best five cards.
- `src/equity.ts` — `equity(hero, board, villains, opts)`. A villain is a
  `Range` or `'random'`.
- `src/outs.ts` — `outs(hero, [3 or 4 board cards])`.
- `src/range.ts` — the 169 classes, notation in and out, `HAND_GRID`,
  `combosOf`, `rangeFromTop`.
- `src/presets.ts` — the preflop baseline charts as ready-made ranges.
- `src/ranking.ts` — the equity ranking, read in a browser-safe way.

## Importing it without the evaluator
The root export pulls in `phe`. Three subpaths do not, and exist so a page can
hold a range picker without the lookup table: `@opentable/equity/range`
(notation, the grid, combos), `/presets` (the baseline charts as ranges) and
`/cards` (the deck and card helpers). The client's tools pages import those
directly and leave every evaluation to the worker.

## Exact or sampled
One number decides, `exactBudget`, counted in hand evaluations:
`villain assignments x board runouts x players`. Under it (default 1.5m)
every runout is enumerated and the answer is the true one; over it the same
loop runs on random deals, `samples` of them (default 20 000), with an
optional seeded `rng`. `EquityResult.exact` says which happened, so a caller
never has to guess whether a number is noisy.

In practice: one random villain is exact on the river (2k evaluations) and on
the turn (91k), sampled on the flop (2.1m) and preflop. A narrow range is
exact far more often than `'random'` is, because it has fewer combinations.

Villain ranges are rejection sampled: when two villains draw the same card
the whole deal is thrown away and redealt, which keeps the sample uniform
over the deals that are actually possible.

## What an out is
A card that lifts hero's made hand into a better **category** on the next
street, judged by dealing it and re-evaluating. Deliberately opponent
agnostic: it does not ask whether the improvement is enough to win, and it
counts a card that pairs the board even though that card helps everyone.
A kicker improvement is not an out.

So the count is usually larger than the number a player would quote. A bare
flush draw is nine cards to them; two overcards pairing also improves the
category, so `count` is fifteen. The familiar number lives in `draws` plus
the cards behind it: `straightOutCards` counts the eight of an open-ender,
and the flush outs are the cards of the drawing suit. A double gutshot is
reported as an open-ended straight draw, since both leave eight cards.

## The preflop data files
`ranking.ts` imports `@opentable/preflop`'s `data/*.json` directly and
re-derives the sort and the percentiles. That duplicates six lines of
`packages/preflop/src/equity.ts` on purpose: preflop reads its own data with
`readFileSync`, which cannot run in a browser, and this package exists to be
imported by a web worker. `ranking.test.ts` asserts the two agree, so a
change to preflop's ranking fails here rather than quietly serving the client
a different ranking from the one the server grades against.
