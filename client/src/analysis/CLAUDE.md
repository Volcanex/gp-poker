# analysis

Equity, outs and hand names, computed in a web worker.

`worker.ts` is the only module that imports `@opentable/equity`'s root, and so
the only one that pulls in `phe`'s half-megabyte lookup table. `index.ts` is the
main thread's request and response API, with cancellation by request id.
`protocol.ts` is the message shape between them. `draw-outs.ts` turns the
package's category outs into the number a player counts. `strength.ts` is the
practice strip's stud arithmetic, pure. `showdown-solve.ts` is
the request the puzzle pages ask a showdown through, and is the only other file
here that touches the package root (see `../puzzles/CLAUDE.md`).

Two panels are drawn from all that: `live-stats.tsx`, the strip on a practice
table, and `replay-panel.tsx` with its pure half `replay-analysis.ts`.

## The practice strip, and the band's section

**Above 1100 px on a v2 table the readings are not a strip at all**: they are a
section on the right of the hero band, ruled off from the controls, and the
strip's row is gone from the table's grid. The owner's note was that the whole
info bar should not be its own bar, and it was the only thing on that screen
that was a bar rather than a part of something. `table.tsx` picks the host and
renders `LiveStats` **once**, because this component drives the worker and two
of it would cancel each other's requests through the module-level request id.
The band's own rules (`.hb-stats` at the foot of `live-stats.css`) are the
strip's rules again in a column: the same three cells stacked, the studs and
the hand's name, the outs count and its draws, the equity meter and its
percentage, each cell the same fixed two lines, and the out cards dropped,
because a 248 px column cannot hold nine cards and the reading they belong to.

Narrower than that, and on v1, it is the strip below, on the felt's own column
(see the cap below: it used to be a number close to `--felt-w` rather than the
token, which is why the two rows did not line up).

A practice table carries one more fixed row between the felt and the band, row 4
of the table's grid (`../table/CLAUDE.md`): one bar, three cells, reading left
to right the way a player thinks. What you hold (the strength meter and the
hand's name), what would improve it (the outs, their draws and the out cards),
and how often it wins (the equity as a `g-meter` with the percentage beside it
and "vs N random hands" under). It is rendered for the whole match rather than
only while you hold cards, and `.practice-strip` holds `--stats-h` whether or
not a number has arrived. The felt gives up the height; the band never does.
`--stats-h` is `.match`'s, and it comes off `--strip-h` at the root, because the
mock's caption stands above this strip and is fixed to the page rather than
inside the table (`../app.css`). The caption adds `--strip-gap` rather than
`--strip-h`, which is the same height until the readings move into the band and
nought after that; the breakpoint is declared once in `../table/hero-band.css`
beside the number `BAND_STATS` uses in `table.tsx`. The bar is capped at
`--felt-w` and centred, like the band's content, so the studs start on the
hero's cards' left edge and the equity ends on the controls' right one.

**The strength meter** (`strength.ts`, drawn by `StrengthMeter` in
`live-stats.tsx`) is nine squares, one per hand category, weakest on the left.
Everything up to the hand you hold is lit in the accent, the studs a live draw
would land on are hollow, and the rest are dark. The category is the worker's
`handName`, the same evaluator that settles pots, so a stud can never disagree
with a showdown; `strength.ts` only maps it to an index, maps each named draw
to the stud it completes on (`drawTargets`, which drops a draw at or below the
made hand and the backdoor draw that completes on no single card), and names
a preflop holding in words (`preflopWords`: pocket kings, suited connectors,
one gapper, suited, offsuit), because before the flop there is no made hand and
the studs are all dark. **Only the stud that has just lit animates**: the top
lit stud is keyed on its category, so a better hand mounts a new node and the
masked reveal runs once on it, while the studs under it snap and a hand that
gets worse snaps dark. `../test/strength.test.ts` pins the mapping.

Every reading sits in a fixed cell. The numbers arrive from the worker after the
labels beside them are already painted, so in a flow the note next to a number
slides the moment it lands, and that is a layout shift on the one screen whose
whole rule is that nothing moves. Every changing value is keyed on itself, and
**every branch of the outs line is keyed too**: React reused the out cards'
node for the river's "No cards to come", and the layout-shift observer counted
that node landing eighty pixels to the left as the strip's only shift. Detail
is dropped rather than wrapped: the out cards go below 1024, and a phone stacks
the studs under the two figures, with the hand's name beside them. The draws'
names are shortened for the strip (`drawWords`: "open-ender", "backdoor
flush"); the replay panel keeps the package's full names.

**Outs at the table are draw outs**, not the package's category outs.
`@opentable/equity` counts every card that improves the made hand category,
which is nine for a flush draw and twenty six for an open-ender, because pairing
either hole card improves the category too. Nobody calls that twenty six outs.
`draw-outs.ts` intersects the category outs with the cards the named draws
complete, so the strip says eight, and with no draw at all it drops to a muted
"Improves on N cards" rather than printing a number a player would misread.

## The replay panel

`replay-panel.tsx` reads every seat it is allowed to see at the step on screen:
the hand's name, its equity and, on the flop and the turn, its outs, with a
strip under it of equity across the streets. What it may read is the felt's rule
and not a quieter one of its own: your own cards if you played the hand,
everybody's once the step reaches a showdown, and everybody's at any step while
"show all cards" is on. Stepping back before the showdown takes the numbers away
again, which is what stops a replay telling you what somebody held before they
showed it.

Every question goes to the worker **one at a time, in the order the page asked
them** (`useHandEquities`), because a hand is dozens of small questions and
firing them together would put the strip's preflop sampling in front of the
street being looked at. An answer is kept under a key that says what was asked
rather than who asked it, so one computation serves the panel, the price beside
an action and the strip. A known holding is a villain in its own right: the
equity package takes a pair of cards as a `Villain`, which collapses the
assignment count to one and is what makes an exact multiway answer affordable.

**The price beside a call** is arithmetic off the state the action was made in,
so it is there whether or not the hand is known; the equity beside it turns up
only once that seat has shown. A call whose equity clears its price is marked.
`practiceSpot` turns the call at the current step into a link to the pot odds
trainer, which reads `?hand=&board=&pot=&bet=&opponents=` and falls back to its
own generator when any part of that does not read.

`replay-analysis.ts` is the pure half: what is known at a step, what a call cost,
and the questions the strip needs. `../test/replay-analysis.test.ts` and
`../test/analysis.test.ts` are its tests.

**The strip's two tables share a column.** `StreetStrip`'s "Seat" header and
`StripRow`'s row header both carry `.ra-seat`, the same fixed-width class
`AnalysisPanel`'s own Seat column uses, so the two cards' first columns line up
under each other rather than each settling on whatever its own longest name
measures; `.ra-shape` and `.ra-dot` are `vertical-align: middle` for the same
reason a graphic with no text in it does not want the table's own baseline
default, which sat the dot under a name's cap height and the sparkline low
against the row beside it.

**A shape cell with nothing resolved yet says so.** `StripRow` draws the
"Computing" placeholder (the same one the panel's own cells use) rather than a
bare `<svg>` when every point in the row is still null: a midline with no point
on it reads as broken, not as a chart still filling in.

**A street nobody acted on still gets a real point.** `streetPoints()`
(`replay-analysis.ts`, `../replay/CLAUDE.md`) builds a `turn`/`river` point
from the final state's own board when an all-in run-out left no state tagged
with it, rather than leave the strip silently short a column on exactly the
hands where the swing matters most. `StreetPoint.runout` marks one, and
`StreetStrip`'s header says so ("Turn*" / "River*", the star titled "Dealt
without a bet" and spelled out under the table) so a reader can tell a
run-out from ordinary play; nothing downstream prices or scores a run-out
point, because nothing was decided on it.

**The strip's own header text must never be wider than its column.** The full
run-out wording ("Turn, dealt without a bet") is what pushed `table.ra-strip`
past its `.table-wrap` at every width the first time this shipped: `.ra-strip`
has no `.ra-table`-style minimum, so an oversized header does not scroll, it
overflows silently, on the exact page a hidden column was already a filed
ticket. `.ra-street-full`/`.ra-street-short` (one word each, swapped by the
560px query already governing `.ra-cell`) and the title-plus-footnote split
for the run-out star both exist to keep the column's own width in charge of
the column. `.ra-strip .ra-cell`'s phone padding override is there for the
same reason from the other side: `.table td` in g.css carries an element
selector, which beats `.ra-cell` alone, so the 12px g gives every cell by
default silently ate more than half of a 3rem phone column before this was
qualified under `.ra-strip` to actually win. Measure both ends after touching
this table — `table.ra-strip`'s width against its `.table-wrap`'s
`clientWidth`, and each cell's `scrollWidth` against its own `clientWidth` —
because a table that merely doesn't overflow can still be ellipsising every
value in it.

**Every fragment this panel prints on its own is sentence case**, the
`priceText` needed/had line, the exact/sampled note beside an equity and the
baseline verdict under a preflop action in `../routes/replay.tsx`: none of them
inherit a capital from anywhere, so each is its own sentence's first word.
