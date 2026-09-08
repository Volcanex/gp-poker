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
