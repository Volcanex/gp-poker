# @opentable/preflop

Heads-up preflop accuracy scoring against cached baseline range charts.
Preflop only. Everything at runtime is a table read: no equity or range is
computed on the fly.

Pure and isomorphic: both JSON data files are static imports
(`with { type: 'json' }`), not `readFileSync`, so this package runs unchanged
on the server, in a client bundle and in a web worker. It imports nothing
from `@opentable/engine` and never touches `phe`, so pulling it into a bundle
never drags the hand evaluator along.

**The charts are heuristic baselines**, hand-built from an equity ranking
and standard heads-up strategy shapes (wide button opens, ranges that
narrow as raises stack up, Nash push/fold approximations under 12bb). They
are **not solver output** and must never be presented or relied on as GTO.
They exist to give a player a rough, explainable signal ("this was a clear
fold"), not a training target.

## Shape
- `src/hand.ts` — the 169 canonical hand classes and `handClass(cards)`.
- `data/equity.json` — `[class, equity]` tuples, sorted descending by
  equity, generated offline by `scripts/equity.ts`. Deliberately an array,
  not an object: JS reorders integer-like object keys ('22', '33', ...) to
  the front regardless of insertion order, which would silently wreck a
  plain-object "sorted" file. `src/equity.ts` imports it as a static JSON
  module (`with { type: 'json' }`) and re-sorts defensively rather than
  trusting the file's order, and derives each class's percentile in the
  ranking (0 = best hand, ~99.4 = worst).
- `data/charts.json` — per stack bucket and spot, cumulative percentile
  cutoffs for the aggressive and passive regions. See below.
- `src/charts.ts`, `src/score.ts` — turn a chart entry into three
  percentile regions (aggr/passive/fold) and score a decision against them.
- `src/extract.ts` — walks a heads-up hand's preflop action log into scored
  `Decision`s, and separately computes per-hand `SeatStats`.
- `src/summarise.ts` — aggregates decisions into an EV-lost/accuracy line.

## Stack buckets and spots
Effective stack = `min(seat stacks) / bb`, in big blinds:
`deep` >= 60, `mid` 25..60, `short` 12..25, `push` < 12.

These are the only decision points that exist heads-up (first-in, or
facing exactly one raise):
- `sb_open` — button/small blind first to act: raise (aggr), limp (passive),
  fold.
- `bb_vs_open` — big blind facing the open: 3bet (aggr), call (passive),
  fold.
- `sb_vs_3bet` — button facing the 3bet: 4bet (aggr), call (passive), fold.
- `bb_vs_4bet` — big blind facing the 4bet: 5bet-jam (aggr), call (passive),
  fold.
- `sb_push` / `bb_vs_push` — push bucket only: jam-or-fold for the opener,
  call-or-fold for the big blind. No passive region on `sb_push`, no
  aggressive region on `bb_vs_push` — see `data/charts.json`.

`extract.ts` identifies a spot from *(position, raises so far)* — e.g. sb
acting with 0 raises is `sb_open`, bb acting with 1 raise is `bb_vs_open`.
Any other combination (bb facing a limp, a line past the 4bet) has no
named spot and is simply not scored, since the product only claims to
grade these specific decisions. Engine actions map onto aggr/passive/fold
as: raise/bet/all-in -> aggr, call/check -> passive, fold -> fold (limping
on the button is `c`, i.e. passive, in `sb_open`).

## Charts (`data/charts.json`)
Each entry is `{ aggr?, passive? }`: cumulative percentile cutoffs on the
equity ranking. `aggr` is where the aggressive region ends; `passive` is
where the passive region ends (so `passive > aggr` when both exist); fold
takes whatever's left up to 100. Current numbers, chosen by hand:

| bucket | spot | aggr | passive | fold |
|---|---|---|---|---|
| deep | sb_open | 80 | 90 | 10 |
| deep | bb_vs_open | 15 | 70 | 30 |
| deep | sb_vs_3bet | 8 | 45 | 55 |
| deep | bb_vs_4bet | 4 | 25 | 71 |
| mid | sb_open | 75 | 82 | 18 |
| mid | bb_vs_open | 13 | 65 | 35 |
| mid | sb_vs_3bet | 7 | 38 | 62 |
| mid | bb_vs_4bet | 5 | 20 | 75 |
| short | sb_open | 70 | 73 | 27 |
| short | bb_vs_open | 10 | 55 | 45 |
| short | sb_vs_3bet | 10 | 30 | 60 |
| short | bb_vs_4bet | 8 | 15 | 77 |
| push | sb_push | 71 (jam) | - | 29 |
| push | bb_vs_push | - | 34 (call) | 66 |

Shape: opens get tighter and limping bands thin out as the bucket gets
shallower (limping loses value with less play left behind); 3bet/4bet/5bet
ranges narrow bucket by bucket except where shallower stacks make jamming
wider correct again (`short` 4bet and 5bet cutoffs tick back up). The push
numbers are a rough Nash push/fold approximation for 10bb effective
heads-up (roughly: push most hands, call much tighter) — treat them as a
ballpark, not a solve. To retune: edit the numbers in `data/charts.json`
directly, they're read at runtime with no build step.

## EV-lost formula (`src/score.ts`)
A hand's percentile lands in exactly one of a spot's regions; that
region's action is `best`. If the actual action differs, `evLost` is:

```
distance = percentile points from the hand to the nearest edge of the
           region *the chosen action* owns (0 only if the action was best)
evLost = min(distance * EV_PER_PERCENTILE, MAX_EV_LOST)
```

`EV_PER_PERCENTILE = 1/18`, anchored on deep `sb_open` (aggr 80, passive
90): folding AA (percentile 0) needs to cross the full 90 points to reach
fold's region, giving `90/18 = 5` bb — matching the target "folding AA
first-in costs about 5bb". The same constant makes a hand one percentile
outside a raise-or-fold boundary (no passive band, e.g. a push chart) cost
about `1/18 ~ 0.056` bb, and grades a bad shove the same way, proportional
to how deep into fold territory it is. Capped at 8bb. If the chosen action
has no region at all in a two-action spot (e.g. `'passive'` in `sb_push`),
the distance is measured against a zero-width point at the nearest defined
boundary so scoring degrades gracefully instead of throwing.

## Regenerating the equity table
```
npx tsx packages/preflop/scripts/equity.ts
```
Monte Carlo, seeded (mulberry32, fixed seed) for reproducibility: for each
of the 169 classes, deals a uniformly random opponent hand and a random
board 40,000 times, evaluates both 7-card hands with `phe` (lower rank
wins), and records win/tie rate. Suit identity never affects equity, so
each class runs from one fixed concrete combo (e.g. `AKs` -> `Ah Kh`).
Takes about 5 seconds. Commit the regenerated `data/equity.json` alongside
any change to the script — runtime never recomputes this.
