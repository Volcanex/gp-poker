# puzzles

The daily puzzles at `/puzzles`. `index.tsx` is the index, the three
`*-page.tsx` files are the pages, `showdown.ts` and `preflop.ts` are the pure
generators, `chart.ts` reads the baseline chart in a browser, `store.ts` is the
record under `ot.puzzles` and `bits.tsx` is the shared furniture. The pot odds
trainer is the fourth puzzle and stays in `../tools/` rather than being
duplicated here; the index just points at it.

## Nothing here is a solver

No puzzle is asked whose answer would need one. Who wins is settled by the
evaluator that settles pots, through a `showdown` request to the analysis
worker: `../analysis/showdown-solve.ts` is the only puzzle module that touches
`@opentable/equity`'s root, so `phe` stays out of the bundle everybody loads.
The preflop spots are graded against the baseline charts, which are heuristic,
and every page says so under the answer.

## Difficulty is structural, not measured

A harder showdown is not one the generator scored and found close, it is one
whose shape makes it close by construction. That is what keeps the generator
pure and the answer the evaluator's. The preflop ramp is the distance from the
hand to the nearest chart cutoff, which narrows as the streak grows.
`showdown.ts` and `preflop.ts` each name their own shapes in their headers.

## chart.ts goes through @opentable/preflop directly

The package reads its two JSON files with static imports, so it is pure and
isomorphic and safe to import in a browser. `chart.ts` re-exports its ranking,
region and scoring functions rather than recomputing them, and keeps only the
puzzle-specific copy (`SPOT_COPY`, `BUCKET_WORDS`, `SPOTS_BY_BUCKET`) local.
`../test/puzzles.test.ts` still checks every bucket, spot and hand class against
the real package by name. That is now mostly a regression pin against a future
edit reintroducing a local copy, rather than a guard against an existing one.
`../routes/learn/chart-data.ts` does the same for the lesson's grid.

## /puzzles/hand replays a real decision

It is lazy loaded for the reason `/m/:id/h/:n` is: it replays a stored hand with
the engine, which pulls in `phe` (see `../replay/CLAUDE.md`). The server does the
walk that finds the decision (`GET /api/puzzles/hand`) and the page replays the
log up to the index it names, so the pot and the price on screen are the
engine's answer rather than numbers the server wrote down.

## The chart enters with the same wave the tools grids do

`preflop-page.tsx` draws its own 13 by 13 chart from `gridFor` rather than
using `../tools/hand-grid.tsx`, because the two agree about nothing except
their shape: one is 169 buttons with a roving tab index and a paint gesture,
this is 169 decorative divs behind one `role="img"` label. What they do share
is the entrance, `useGridEntrance` in `../ui/grid-entrance.ts`, which is why
the chart cells carry `data-r` and `data-c`: that is what the wave orders by.

The chart takes no `wave`, because it mounts fresh for every answer and
unmounts on the next spot, so mounting is the only thing that can ever mean a
new chart. Only opacity and a transform are touched, so the verdict above it
and the score row below it do not move while it arrives.

## The record

One object under `ot.puzzles`: a streak, best streak and count per type, plus
the day and the number solved on it. The pot odds trainer keeps its own older
record under `ot.odds` and keeps it there.
