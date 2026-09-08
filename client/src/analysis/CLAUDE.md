# analysis

Equity, outs and hand names, computed in a web worker.

`worker.ts` is the only module that imports `@opentable/equity`'s root, and so
the only one that pulls in `phe`'s half-megabyte lookup table. `index.ts` is the
main thread's request and response API, with cancellation by request id.
`protocol.ts` is the message shape between them. `draw-outs.ts` turns the
package's category outs into the number a player counts. `showdown-solve.ts` is
the request the puzzle pages ask a showdown through, and is the only other file
here that touches the package root (see `../puzzles/CLAUDE.md`).

Two panels are drawn from all that: `live-stats.tsx`, the strip on a practice
table, and `replay-panel.tsx` with its pure half `replay-analysis.ts`.

## The practice strip

A practice table carries one more fixed row between the felt and the dock, row 4
of the table's grid (`../table/CLAUDE.md`), reading the hand you hold, the outs
and your equity against that many random hands. It is rendered for the whole
match rather than only while you hold cards, and `.practice-strip` holds
`--stats-h` whether or not a number has arrived. The felt gives up the height;
the dock never does. `--stats-h` is `.match`'s, and it comes off `--strip-h` at
the root, because the mock's caption stands above this strip and is fixed to the
page rather than inside the table (`../app.css`).

Every reading sits in a fixed cell. The numbers arrive from the worker after the
labels beside them are already painted, so in a flow the note next to a number
slides the moment it lands, and that is a layout shift on the one screen whose
whole rule is that nothing moves. Three widths' worth of detail is dropped
rather than wrapped: the card list and the draw's name go below 1024, and the
note under the equity goes on a phone, leaving one line of hand, outs and
number.

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
