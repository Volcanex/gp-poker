# replay

Re-deriving a stored hand in the browser. `to-view.ts` turns an engine
`HandState` into a `TableView` so the same table components a live match uses
draw it; `fairness.ts` re-derives the deck and rehashes the commitment. The page
around them is `../routes/replay.tsx` and the analysis panel under the felt is
`../analysis/`.

`replay(config, actions)` from the engine returns one `HandState` per step. Step
0 is the deal; step k is after k actions. The engine ships pure-JS hashing
(`@noble/hashes`), so all of this runs in the browser with nothing asked of the
server beyond the hand row.

## The engine counts seats densely, the record counts them by chair

A hand dealt to four of a six-max table gives the engine seats 0..3, while the
hand row's actions, holes, button and study are all in table seats. `live_seats`
on the row maps one to the other, and `liveSeats()` in `../net/adapt.ts` supplies
the identity for every heads-up row ever written.

The page builds the engine config through that map, translates the logged
actions into engine seats, and `to-view.ts` puts each seat back in its chair. An
action from a seat that never sat down **fails the replay** rather than being
attributed to someone else. `startStacks()` handles the two shapes `stacksStart`
can arrive in, and the fairness panel takes the same map so a recorded hole card
is compared against the card that seat was actually dealt.

## Keep the engine out of the eagerly loaded routes

**The replay route is lazy loaded** (`React.lazy` in `../app.tsx`), and so is
`/puzzles/hand`. The engine pulls in `phe`, whose hand evaluator carries a large
lookup table; splitting it keeps roughly 80 kB gzipped out of the bundle
everyone loads to play. Importing the engine from, say, the table or the match
summary would undo this silently, which is why `../table/best-five.ts` exists at
all.

## Fairness is checked here, not taken on trust

`fairness.ts` runs both checks in the browser on the published seed:
`sha256(seed)` against the commitment, and `deckFromSeed(seed)` dealt in engine
order against the recorded holes and board. Nothing is taken from the server.
The deal order is round robin from the seat left of the button, one card each
then the second card each, board straight after with no burns
(`packages/engine/CLAUDE.md`); `dealFromDeck` is that rule and
`../test/replay.test.ts` pins it.

## Baseline verdicts

The verdicts beside preflop actions come from the hand row's `study`, which the
server writes as `{seat: {decisions, evLost, accuracy}}`. Each of a seat's
preflop actions is paired with that seat's decisions **in order**. That is sound
because the scorer walks the same actions in the same order and only ever drops
decisions off the end (a spot stops being a named spot once the raises stack
past a 3bet), never from the middle. Actions past the last scored decision carry
no verdict, which is why deep 4bet wars annotate their first few actions and
then stop.

A seat's rating is 0 in a replayed view: a hand row does not record what the
players were rated at the time, and a made-up number beside a name is worse than
no number, so the seat hides it.

## The felt is v2, bare, and capped at 520px

`replay.tsx` passes `<Table ... bare look="v2">`. `look="v2"` is what gives the
replay the current cards and chips (`playing-card.tsx`'s SVG faces,
`chip-stack.tsx`'s ticking columns); `bare` keeps the hero band off regardless
of `look`, since `band = look === 'v2' && !bare && !ended` in `table.tsx` — a
replay has no hero seat, so nothing about turning the band on ever applied
here. Before this the replay drew `v1`'s default look, which is effectively
unmaintained now that every live table draws v2 (`table/CLAUDE.md`, "The v2
felt"): its cards were blank rounded rectangles.

`.match[data-bare]` in `replay.css` caps the felt at 520px and centres it in
its card, rather than filling the card's own width. That number is not
decorative: `.match { container-type: inline-size }` is what the felt's own
`@container` queries in `app.css` read, and a replay's felt sits in a
two-column page (the felt beside a 268px action list) inside `.page.wide`'s
980px cap, which lands its width somewhere around 600-900px on an ordinary
window — short of the 1060px a seat needs to stand in its full wing, and past
the 560px a seat's compact form starts at. A seat's own grid has nowhere to
put the identity block in that gap, which is what the reported "chip stack and
figure drawn on top of each other" bug was: not an overlap bug in the seat
itself, but the one place on the site that ever handed the felt a width
between those two numbers. A live table's felt is always either the viewport's
own width (comfortably past 1060 on a desktop) or actually a phone's (under
560, where the felt's `data-rows` layout takes over instead), so the gap never
showed anywhere else. 520 sits inside the compact range on every window.

The stats box (`Hand`/`Street`/`Blinds`/`To call`) is hidden in bare mode
(`.match[data-bare] .stats`): it exists to fill a live table's otherwise spare
corner, a replay has none, and the same four facts are already in the page's
own header and its action list.

## A run-out street is built from the final board, not found in the states

`packages/engine`'s `replay()` returns one state per *logged action*
(`packages/engine/src/replay.ts`), and an all-in run-out deals every
remaining street inside a single transition (`runOutAndShowdown`/
`dealNextStreet` in `packages/engine/src/deal.ts`) with no action of its own
to hang a state on. A hand that goes all in on the flop and runs out to a
river showdown has a `states` array that jumps from a `flop` state straight to
a terminal one with a five-card board: nothing in it is ever tagged `turn` or
`river`. `streetPoints()` in `../analysis/replay-analysis.ts` scans `states`
for each street first and, for one it finds no state for, builds the point
itself from the final state's own board (`final.board.slice(0, 4)` for the
turn, `.slice(0, 5)` for the river) and the seats `contestingSeats(final, ...)`
still shows in the hand — real cards and real seats, nothing sampled or
guessed, marked `runout: true` on the `StreetPoint` so the strip can say so.

This is deliberately **not** a `packages/engine` change: `states` is indexed
by logged action everywhere outside this module too (`useAnalysis` in
`../routes/replay.tsx` pairs `hand.actions[i]` to `states[i]` to price every
call, and the scrubber counts `states.length` for "N of M"), so inserting a
state for a street nobody acted on would silently break both. The strip is
the one reader of `streetPoints()` that wants a point for every street the
board reached regardless of whether an action opened it, so it is the one
place that builds it.

A run-out point carries no action and must not be treated as though it does:
nothing prices it (`prices` in `replay.tsx` stays keyed to `hand.actions`, and
a run-out street has none) and nothing scores it (`studyFor` is preflop only).
`StreetStrip`'s header marks a run-out column in the strip's own voice
("Turn, dealt without a bet") rather than let it read as a street played
normally. `StripRow` also shows a "Computing" placeholder rather than a bare
midline when a row has resolved nothing at all yet — a real fix for a cell
that reads as broken while the worker is still answering, orthogonal to the
run-out gap above but easy to mistake for the same bug (both show as an empty
shape cell).
