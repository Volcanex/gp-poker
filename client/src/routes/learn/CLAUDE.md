# learn

The eight lesson pages under `/learn`, plus the index that lists them.

## The order lives in one place

`lessons.ts` is the sequence: the index renders it, `index.tsx` builds one
`<Route>` per entry from it, and `lesson.tsx` reads the next lesson out of it
for the "Next" link at the foot of every page. A lesson never states where it
sits. Adding one is an entry in `LESSONS` plus a component in the `PAGES` map,
and it is then listed, routed and linked to.

## Every number comes from the code

A lesson that types a constant into its copy goes quietly wrong the day the
constant moves, and nothing fails. So the formats, blinds, clock, hand cap and
blind schedule are read from `@opentable/protocol` (`HEADS_UP_FORMAT`,
`SIX_MAX_FORMAT`, `HAND_HOLD_MS`), and `constants.ts` derives the rest.

`PROVISIONAL_RD` is the awkward one: `isProvisional` in `@opentable/rating`
holds its threshold as a literal inside the function rather than exporting it,
so `constants.ts` reads it back out by walking integers until the function
flips. That is deliberate. Copying `110` into the copy would be the drift this
directory is trying to avoid.

Two numbers are still written out, in `fair.tsx`: the 32 byte seed and the 52
card deck from `packages/engine/src/random.ts`. Importing the engine to get
them would pull its hand evaluator's lookup table into the bundle everybody
loads, which is the whole reason the replay route is lazy loaded. The comment
at the top of that file says so.

## The range grid goes through @opentable/preflop

`chart-data.ts` imports `chartFor`, `percentileOf`, `regionsOf` and `RANKS`
straight from `@opentable/preflop`. The package reads its two JSON files with
static imports now, so it is pure and isomorphic and this import works
unchanged in the browser. `chart-data.ts` keeps only what is genuinely
display logic: `gridFor` and `countRegions`, which turn a chart entry into
the 13 by 13 grid `ranges.tsx` draws. `regionFor` does the same
first-matching-region walk `scoreDecision` uses to pick its `best`, so the
grid always agrees with what the accuracy scorer would call correct.

## Diagrams reuse the app's own components

Cards are `BoardText` from `src/ui/board-text.tsx`, the same component the
match tables and hand lists use, so a card on a lesson page is the card the
table deals. Tables are g's `.table`. The seat chips and the range grid are the
only bespoke pieces, and their styles are in `learn.css`, never `app.css`.
