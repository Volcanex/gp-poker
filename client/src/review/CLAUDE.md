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
seat: a six-max sit-and-go is commonly under fifty hands split six ways by
elimination order, so a seat that busts early might see nine. Lowering the
floor for this page would be the exact failure the owner warned against:
a confident-looking percentage born from nine hands.

So the floor is never lowered. `computeMatchReview` calls `computeInsights`
unmodified and prints its nulls as-is (`PlayerCard`'s career line only
appears once a seat's own insights actually resolve). Beside it,
`computeRawRates` (`server/src/insights.ts`) runs the same fold with the gate
removed and returns a plain count either side of a divide for six axes:
"3 of 8 hands", never "38%". A count is honest at any sample size; a rate
implies a stable tendency that a count does not. `reads.ts` goes one step
further and only turns a count into a sentence once it is large enough that
the sentence means something (a hand-picked floor per axis, well under 20,
documented at each check): "never three-bet, 3 times this match" is a fact
about this match at three chances; "your three-bet is low" is a claim about
this player that three chances cannot support.

The spider (`spider.tsx`) draws the raw counts, not the gated ones, because a
match review is inherently about one sitting. Every axis prints its own
count in the legend beneath the shape, and an axis with no denominator is a
hollow marker on a dashed spoke, never a point plotted at zero. Reading the
shape without reading the legend under it is exactly the failure mode this
file exists to prevent, so the legend is never optional and never collapsed
behind a toggle.

**The shape itself has to carry the uncertainty, not just the legend beside
it.** The first version of this chart used "does a denominator exist" as its
only honesty check: an axis with `of: 0` got the hollow no-data marker, and
anything with `of` greater than zero got a filled point at its ring
position, the same as a career-length sample. That is wrong in a way the
no-data check does not catch: presence of a denominator is not the same as
sufficiency of one. A seat dealt one hand that played it goes 1 of 1 on
VPIP, PFR and went-to-showdown: a real, backed rate, plotted at the very
edge of the ring, drawing the single most confident-looking shape the chart
can produce from the single least amount of evidence it can hold. That is
the exact inversion the feature exists to prevent, and six-max makes it the
common case, not the edge case: a seat that busts in the first orbit is
ordinary, not rare.

The fix is `wilsonInterval` in `style.ts`, the standard 95% confidence
interval for a binomial proportion estimated from a small sample (a Wald
interval centred on the point estimate is a bad approximation exactly where
this matters: low n, p near 0 or 1). `axisPoints` normalises its lower and
upper bounds onto the same ring the point is, and `Spider` draws them as an
inner and an outer polygon with the fill only in the band between them,
never from the centre out, which would just be the old always-filled shape
again with extra steps. At `of: 1` the band swallows most of the axis; by
`of: 44` it draws tight around the point. There is no threshold anywhere in
that arithmetic for a sample to cross before it is "trusted": the
uncertainty shrinks in continuous proportion to the evidence, which is what
answers the "3 of 8 versus 300 of 800" question without either of us having
to pick a cutoff. Because it is geometry rather than a caption, it survives
someone screenshotting the shape with the legend cropped out, which a
sentence under the chart cannot.

Aggression factor gets no band. Wilson is defined for a proportion (a share
of a fixed number of trials), and aggression factor is bets-and-raises per
call, a ratio that is not bounded at 1 and is not a share of anything fixed.
Applying a binomial interval to it anyway would be a second, quieter unbacked
claim stacked on top of the first one this fix removes, so that axis stays a
point alone and the legend says so (`spider-flag`, "no interval, a ratio not
a share") rather than silently doing the wrong arithmetic. `of: 0` is
untouched by any of this: still the hollow marker on a dashed spoke, because
"no chances" and "one chance" are genuinely different states and a wide band
would blur them into the same picture.

`client/src/test/review.test.ts` pins the shape of this: `wilsonInterval` at
`of: 1`, `of: 8` and `of: 44` with the width strictly shrinking, both bounds
held to `0..1`, and `axisPoints` asserting a one-hand VPIP band swallows over
a third of the ring while a same-match 44-hand one does not, plus the
aggression-factor and `of: 0` axes both carrying no band at all.

The accuracy tile is the other place this shows up: six-max stores no
preflop study at all (`server/src/match/handRunner.ts`), which is a
different fact from a seat that had no scoreable decision, and the tile says
which one applies rather than collapsing both into "no data". The "little i"
next to it is the sentence the owner asked for almost verbatim: accuracy is
preflop only, and the most accurate player does not always win. `MatchReview`
also raises that as its own banner whenever the numbers actually back it
(two or more graded seats, and the most accurate one did not win), rather
than only living in a tooltip.

## Why the charts are bespoke SVG

Same reasoning as `client/src/ui/rating-graph.tsx` and `profile.css`'s two
charts: g ships `g.chart`, but it draws into a DOM node it owns and
re-renders by being called again, which fights React. `spider.tsx` and
`chip-spark.tsx` are drawn as JSX for the same reason.

**The chip chart is small multiples, not six overlaid lines.** The first cut
put every seat's stack on one chart, one of g-system's six `--chart-1..6`
hues each. A CVD check on those exact six tokens on the dark surface fails:
`#e93d82` (chart-5) and `#12a594` (chart-3) sit 3.6 deltaE apart under
deuteranopia and 1.9 under tritanopia, both well under the 15 a reader needs
to tell two lines apart, and `#46a758` vs `#12a594` fail even for ordinary
colour vision at 8.4. Six is also one past what a legend can carry with
direct labels. `chip-spark.tsx` is the fix: one sparkline per seat, inside
that seat's own card, drawn in a single colour every time
(`var(--chart-1)`), so identity comes from the card it sits in rather than
from a hue nobody can be asked to separate six ways. "You" is heavier
(`stroke-width`), never a different colour, the same rule the spider's own
`data-you` weight follows. Every card's sparkline shares one y scale
(`maxChips`, computed once in `match-review.tsx`), not an auto-fit range
each: a seat that only ever held 200 units has to draw shorter than one that
ran to 800, or the small multiples would each be comparing a different scale
as if it were the same chart.

**The radar's reference band is printed, not implied.** A ring position
means nothing without the band it is normalised against sitting somewhere a
reader can see it, so the `<details>` under each spider (`spider-band` in
`review.css`) spells out every axis's typical range and what fills the ring
outright, and the axis order (`AXES` in `style.ts`) is fixed and identical
on every player's chart, because a reordered axis changes the shape's
silhouette and two players' shapes stop being comparable. One radar per
seat, never two players' shapes filled on the same chart: comparison comes
from the cards sitting side by side in `review-grid`, not from overlaid
polygons.

## The hands table on a phone

`HandsSection` (the fifty-row hand list) lives in
`client/src/table/match-summary.tsx`, out of this directory's ownership
during the multi-agent pass that built this feature (see the sibling agent
briefs: the table is another agent's surface). `#hands` is stable markup on
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
  for it. **Promotion: yes**, as a small `g-info` component, since any project
  vendoring g will eventually want a number with a caveat next to it.
- **The spider** (`spider.tsx`): six-axis radar with a reference band and a
  legend that never hides. **Promotion: maybe.** The honesty rules baked into
  it (hollow markers for missing axes, fill strength tied to completeness)
  are specific to this feature's stakes; a generic g-system radar would need
  to decide whether that behaviour is the default or an opt-in.
