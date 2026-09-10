# review

The match-level review on `/m/:id`, under the result and the hand list:
what every seat at one finished match actually did, backed by
`server/src/match-review.ts` (`server/src/CLAUDE.md`). `match-review.tsx` is
the section, fetched once per match and cached forever server-side, the same
bargain `profile.tsx`'s insights section makes with its own cache.

## The sample-size problem, and why it is answered this way

`insights.ts` already draws the honesty line for a career: below
`MIN_INSIGHT_HANDS` (20) every rate is null, because a rate nobody can trust
is a claim nobody made. A single match rarely clears that line for any one
seat — a six-max sit-and-go is commonly under fifty hands split six ways by
elimination order, so a seat that busts early might see nine. Lowering the
floor for this page would be the exact failure the owner warned against:
a confident-looking percentage born from nine hands.

So the floor is never lowered. `computeMatchReview` calls `computeInsights`
unmodified and prints its nulls as-is (`PlayerCard`'s career line only
appears once a seat's own insights actually resolve). Beside it,
`computeRawRates` (`server/src/insights.ts`) runs the same fold with the gate
removed and returns a plain count either side of a divide for six axes —
"3 of 8 hands", never "38%". A count is honest at any sample size; a rate
implies a stable tendency that a count does not. `reads.ts` goes one step
further and only turns a count into a sentence once it is large enough that
the sentence means something (a hand-picked floor per axis, well under 20,
documented at each check) — "never three-bet, 3 times this match" is a fact
about this match at three chances; "your three-bet is low" is a claim about
this player that three chances cannot support.

The spider (`spider.tsx`) draws the raw counts, not the gated ones, because a
match review is inherently about one sitting. Every axis prints its own
count in the legend beneath the shape, and an axis with no denominator is a
hollow marker on a dashed spoke, never a point plotted at zero: the polygon's
fill is only drawn at full strength when every axis has a real count behind
it, a wash otherwise. Reading the shape without reading the legend under it
is exactly the failure mode this file exists to prevent, so the legend is
never optional and never collapsed behind a toggle.

The accuracy tile is the other place this shows up: six-max stores no
preflop study at all (`server/src/match/handRunner.ts`), which is a
different fact from a seat that had no scoreable decision, and the tile says
which one applies rather than collapsing both into "no data". The "little i"
next to it is the sentence the owner asked for almost verbatim: accuracy is
preflop only, and the most accurate player does not always win. `MatchReview`
also raises that as its own banner whenever the numbers actually back it —
two or more graded seats, and the most accurate one did not win — rather
than only living in a tooltip.

## Why the charts are bespoke SVG

Same reasoning as `client/src/ui/rating-graph.tsx` and `profile.css`'s two
charts: g ships `g.chart`, but it draws into a DOM node it owns and
re-renders by being called again, which fights React. `spider.tsx` and
`chips-chart.tsx` are drawn as JSX for the same reason, reading `--chart-1`
through `--chart-6` so they stay legible across all four palettes
(`client/src/palettes.css`) and the games room theme (`client/src/room.css`)
without a colour of their own.

## The hands table on a phone

`HandsSection` (the fifty-row hand list) lives in
`client/src/table/match-summary.tsx`, out of this directory's ownership
during the multi-agent pass that built this feature (see the sibling agent
briefs — the table is another agent's surface). `#hands` is stable markup on
the section, the same way a g component is restyled through its own slots
rather than edited: `review.css`'s phone breakpoint narrows the board text,
the padding and the "won by" column from outside that file rather than
touching its JSX. A markup-level rebuild (a stacked card row instead of a
table row) would need to live in `match-summary.tsx` itself and is flagged,
not done here.

## Promotion candidates for g-system

- **The info trigger** (`.i-btn` in `review.css`, `AccuracyTile` in
  `accuracy.tsx`): a bare button wired to g-ui's own `data-tip` tooltip
  behaviour, because g ships the tooltip layer but no inline glyph trigger
  for it. **Promotion: yes**, as a small `g-info` component — any project
  vendoring g will eventually want a number with a caveat next to it.
- **The spider** (`spider.tsx`): six-axis radar with a reference band and a
  legend that never hides. **Promotion: maybe.** The honesty rules baked into
  it (hollow markers for missing axes, fill strength tied to completeness)
  are specific to this feature's stakes; a generic g-system radar would need
  to decide whether that behaviour is the default or an opt-in.
