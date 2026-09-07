# client

React 19 + Vite front end for Open Table. Served by the server from
`client/dist` in production; in development `vite` proxies `/api` and `/ws`
to `127.0.0.1:8130`.

**Owner:** Gabriel Penman
**Design:** g-system, vendored at `public/g/` (`g.css`, `g-ui.js`, `fonts/`).
Never hand-edit those; re-run `node scripts/vendor.mjs` from the g-system repo.

## Run
- `npm run dev -w client` (port 5180, proxies to the server on 8130)
- `npm run build -w client`, then `npx vite preview --port 4173` for the bundle
- `npx tsc -p client/tsconfig.json` typechecks; `npm test -w client` runs the
  unit tests for the pure logic (sizing, labels, replay stepping, fairness)

`tsconfig.json` includes `../packages/engine/src/vendor.d.ts`: the client
compiles the engine's TypeScript source directly, so it needs the same ambient
declaration for `phe` that the engine's own tsconfig provides.

## Shape
- `src/net/` — the wire. `types.ts` mirrors the REST payloads, `api.ts` is the
  fetch layer, `adapt.ts` reads the fields the server has not shipped yet,
  `socket.ts` is the single WebSocket, `session.tsx` owns the session, the
  connection state, the queue and the match to return to.
- `src/routes/` — `home.tsx`, `leaderboard.tsx`, `profile.tsx`, `match.tsx`
  (live table, finished summary and the mock), `replay.tsx`.
- `src/table/` — the table. `table.tsx` renders one `TableView`; `seat.tsx`,
  `playing-card.tsx`, `timer-ring.tsx`, `action-bar.tsx` are its parts.
  `match-summary.tsx` is the finished-match page. `sizing.ts`, `labels.ts`,
  `layout.ts` (where each seat sits) and `results.ts` (the finishing order)
  are pure.
- `src/replay/` — `to-view.ts` turns an engine `HandState` into a `TableView`;
  `fairness.ts` re-derives the deck and rehashes the commitment.
- `src/ui/` — `auth.tsx` (claim, log in, account menu), `rating-graph.tsx`,
  `board-text.tsx`, `bits.tsx`, `format.ts`, `title.ts`.
- `src/dev/mock.ts` — the scripted live table, dev only.
- `src/app.css` — page layout plus the poker-specific pieces. Tokens only.

## The table, two to six seats

One component draws every table. `layout.ts` is the whole geometry and it is
pure, so the rotation is unit tested rather than eyeballed:

- **Rotation.** `seatOrder` puts the viewer at the bottom and the rest in seat
  order after them, so the player on your left, the next to act, is the next
  one round to the left. Watching (a spectator, or a replay) seat 0 takes the
  bottom, so the same match reads the same way round every time it is opened.
- **Two shapes, one markup.** `layoutMode` is `stack` for two seats and `ring`
  for three to six. Stack is the three-row felt heads-up has always had; ring
  places seats on an ellipse. The difference is entirely CSS on
  `.felt[data-mode]`: a seat, a bet and a chip flight are the same elements
  either way, which is why the heads-up layout survives untouched.
- **Nothing overlaps, by construction.** In ring mode each seat owns a layer
  inset by half a seat box, so a seat at the far edge of the ellipse still sits
  inside the felt. The bet gets the same layer inset further by a whole seat
  box: the same ellipse shrunk by exactly the room a seat takes up, which is
  why a chip always lands between its seat and the pot and never under either.
  Both read the same `--x`/`--y`.
- **The felt sizes itself with container queries**, not media queries: the
  replay draws this table in a narrow column beside its action list, so the
  question is how wide the felt is, not how wide the window is. `.match` is the
  container. Below 640px the seat drops to three rows (the name gets the width
  of the box), the rating goes, and seats move to `--yt`, a pinched ellipse
  that keeps them off the board when there is no room to clear it sideways.
- **Dealing.** `dealOrder` is round robin from the seat left of the button, one
  card each then the second, which is the order the engine deals in; the seat
  passes it to `PlayingCard` as the stagger index. In ring mode each card also
  starts from the middle of the table, so cards fan outwards.

`SeatView.out` seats render dimmed with their place ("4th") where the stack
would be, and `SeatView.bot` gets a small mark beside the name.

## Routes
| Path | Page |
| --- | --- |
| `/` | queue, how it works, top ten |
| `/leaderboard` | top 100 |
| `/u/:name` | profile |
| `/m/:id` | live table while playing, result summary once finished |
| `/m/:id/h/:n` | hand replay, scrubber and fairness checks |
| `/m/mock` | the scripted table, dev only (`?step=N` freezes one moment, `?mode=six-max` runs the six-handed script) |

`useTitle` (`src/ui/title.ts`) sets the document title per route and appends
the product name, so it is spelled in one place.

## Socket contract
The session is a cookie the server sets on the first `GET /api/me`, so the
socket is opened only after that call succeeds. **A server that is not
answering therefore never produces a reconnect storm and never logs a failed
WebSocket connect**: the home page shows its offline state instead.

`socket.ts` holds one connection for the whole app. It reconnects with
exponential backoff (500 ms to 8 s, jittered), pings every 20 s, and buffers
sends while the socket is down. Sends are typed `ClientMsg`; subscribers get
every `ServerMsg` and filter for themselves (`useServerMsg` in `session.tsx`).

Queueing sends `{t:'queue', mode, rated}`; the mode picker on the home page
owns that choice and `session.tsx` remembers it in `localStorage`
(`ot-play-choice`), so "play again" repeats the match that just finished.
`readPlayChoice()` returns null until something has been played, which is how
the picker knows not to claim a mode was played last on a first visit.

Acting sends `{t:'act', m, h: view.h, n: view.n, a, v}` and disables the bar
until a state with a different `h:n` arrives. The server refuses a stale action
with `err`, so a replayed act is rejected rather than misapplied.

**`/api/me` is refetched** after `end`, and after claim, login and logout.
A finished match has just moved the rating, and the top bar was still showing
the value from before it. Claim and login also merge the summary they return so
the name changes immediately, with the refetch behind it for the counts.

**The match to return to** is remembered in `localStorage` whenever a `state`
arrives with a seat for you, and cleared on `end`. On load it is offered only
after `GET /api/matches/:id` confirms the match is still playing: a match that
finished while the tab was closed is not a match to return to.

## REST contract
Shapes mirror `server/src/routes.ts` exactly; `src/net/types.ts` is the
mirror, and dates are strings there because JSON has no Date.

**A hand's primary key is `<match id>-<number>`** (`server/db/schema.sql`), so
`/m/:id/h/:n` addresses `GET /api/hands/<id>-<n>` with no lookup step. If that
key ever changes, `api.hand()` is the one place to change.

**Fields the server is still adding go through `src/net/adapt.ts`**, never
read directly: mean preflop accuracy and a total match count on
`/api/users/:name`, per-seat accuracy on the hands list of `/api/matches/:id`,
a seat's bot flag, `place`/`players`/`rated` on a profile's match history (a
placing needs both halves before "1st of 6" can be said at all), and a hand
row's `live_seats`. That file is the single place to change when the names are
confirmed, and the UI above it never learns a name. Absent and null both mean
"no number", and the caller hides its tile or column rather than printing a
zero; a real zero (a hand scored 0% accuracy) still shows, which is why the
adapter tests distinguish the two.

Two things the endpoints do not carry, left out rather than invented:
- **A total match count for another player**, until the profile carries one.
  `lastMatches` is capped at twenty, so it is never passed off as a total: the
  count comes from the endpoint when it sends one, else from `/api/me` on your
  own profile, else the fact is not shown.
- **Per-hand study on the match page** beyond the accuracy column. The full
  decision list lives on the replay page, which has the hand row.

**Every rating and delta is rounded at the display site** (`int` and `signed`
in `src/ui/format.ts`). The server sends integers, but a fraction must never
reach the screen: a delta once rendered as "+162.31089256906034". Rounding
where the number is printed does not depend on the producer staying correct.

## The replay
`replay(config, actions)` from the engine returns one `HandState` per step, and
`stateToView` renders each through the same table components a live match uses.

**The engine counts seats densely, the record counts them by chair.** A hand
dealt to four of a six-max table gives the engine seats 0..3, while the hand
row's actions, holes, button and study are all in table seats. `live_seats` on
the row maps one to the other and `liveSeats()` supplies the identity for every
heads-up row ever written. The replay builds the engine config through that
map, translates the logged actions into engine seats (an action from a seat
that never sat down fails the replay rather than being attributed to someone
else), and `stateToView` puts each seat back in its chair. `startStacks()`
handles the two shapes `stacksStart` can arrive in, and the fairness panel
takes the same map so a recorded hole card is compared against the card that
seat was actually dealt.
Step 0 is the deal; step k is after k actions. The engine ships pure-JS hashing
(`@noble/hashes`), so all of this runs in the browser.

**The replay route is lazy-loaded** (`React.lazy` in `app.tsx`). The engine
pulls in `phe`, whose hand evaluator carries a large lookup table; splitting it
keeps roughly 80 kB gzipped out of the bundle everyone loads to play. Keep the
engine out of the eagerly loaded routes: importing it from, say, the table or
the match summary would undo this silently.

**Baseline verdicts** beside preflop actions come from the hand row's `study`,
which the server writes as `{seat: {decisions, evLost, accuracy}}`. Each of a
seat's preflop actions is paired with that seat's decisions **in order**. That
is sound because the scorer walks the same actions in the same order and only
ever drops decisions off the end (a spot stops being a named spot once the
raises stack past a 3bet), never from the middle. Actions past the last scored
decision simply carry no verdict, which is why deep 4bet wars annotate their
first few actions and then stop.

**The fairness panel** runs both checks in the browser on the published seed:
`sha256(seed)` against the commitment, and `deckFromSeed(seed)` dealt in engine
order against the recorded holes and board. Nothing is taken on trust from the
server. The deal order is round robin from the seat left of the button, one
card each then the second card each, board straight after with no burns
(`packages/engine/CLAUDE.md`); `dealFromDeck` in `src/replay/fairness.ts` is
that rule and the unit test pins it.

## g-system usage
Everything g ships is used as it ships: `.btn` and its variants, `.input`,
`.switch`, `.g-slider`, `.table`, `.card`, `.badge`, `.empty`, `.skeleton`,
`.kbd`, `.prose`, `.spinner`, `.copy-btn`, `.menu[popover]`, `dialog.dlg`, and
`g.theme()` behind the theme button. Bet chips are `.badge` with `.num`, not a
bespoke chip.

Four things to know:

1. **`g.init` and React.** g-ui.js wires its behaviour layer at load; React
   mounts later. `useGInit` (`src/ui/bits.tsx`) asks for a pass over a subtree
   and stamps it so a second pass is a no-op. Two nodes are co-owned: the
   `.copy-btn` in the hand header (g inserts icons and rewrites the label on
   click) and the account `.menu` (g positions it and binds its items). Their
   React children must stay constant, and the menu handlers call
   `hidePopover()` themselves so a re-rendered item still closes the menu.
2. **The slider.** g owns the fill and the readout and syncs them on the input
   event. The action bar keeps the range React-controlled and replays a native
   input event after a programmatic change, so g stays the only thing that
   computes the fill. React bails on a set to the same value, so it cannot loop.
3. **Two docs-app rules are copied into `app.css`.** `.stat` (the stat tile)
   and `.switch-row` ship as markup and as React components, but their CSS
   lives in the g-system docs app rather than in `g.css`. Both copies are
   marked in `app.css`. **Delete them when g-system ships those rules.**
4. **Keyboard shortcuts and typing.** `isTextEntry` in `src/ui/bits.tsx` is the
   one guard: it treats text fields, textareas, selects and contenteditable as
   typing, but not checkboxes, radios, buttons or ranges. Arrow keys stepping a
   replay must still work right after someone clicks the "show all cards"
   switch, which is what a blanket "is it an input" test got wrong.

The accent slot is not overridden. g's default accent is the far end of the
neutral scale, and that is the one accent this app uses: the acting seat's
timer ring, the primary action, your own row on the leaderboard. A rebrand
would set `--accent-fill/-hover/-fg/-edge` and nothing else.

## Keyboard
| Key | Where | Does |
| --- | --- | --- |
| `f` | your turn | fold |
| `c` | your turn | check, or call |
| `r` | your turn | focus the raise amount |
| left, right | replay | step back, step forward |

## Bespoke components (promotion candidates for g-system)
Poker-specific pieces live here only because g has nothing close. If one stops
being poker-specific, build it in g-system, not here.

- **`playing-card.tsx`** — rank and suit on a surface, plus face-down and
  empty-slot states. The empty slot holds the board's width so nothing shifts
  as streets arrive. Red suits use `--danger-text` as the palette's red;
  nothing destructive in this app is red (Fold is `btn-tertiary`), so the
  meaning colour is not overloaded. **Promotion: no, this is poker.**
- **`timer-ring.tsx`** — a countdown driven by a server deadline rather than a
  local duration, so a reconnecting client lands on the right remaining time.
  **Promotion: yes.** g ships `.g-progress` and `.g-meter` but nothing that
  counts down.
- **`seat.tsx`**, **`action-bar.tsx`** — poker furniture. The action bar's
  "bounded number with presets, a slider and a typed input, all clamped to one
  range" is the generic half; the poker words are not. **Promotion: partly.**
- **`rating-graph.tsx`** — a single line over time. g ships `g.chart`, but it
  draws into a node it owns and re-renders by being called again, which fights
  React. **Promotion: yes**, as a React-friendly sparkline. Note the line
  stretches to its box (`preserveAspectRatio="none"`) and holds its width with
  `vector-effect`, which is why it has no marker: a circle would stretch into
  an ellipse.
- **`board-text.tsx`** — cards as text for dense tables. **Promotion: no.**
- The replay scrubber, action list and fairness panel are page furniture, not
  components. **Promotion: no.**

## Gotchas
- There is no `--surface` token. Use `--surface-1` (page) and `--surface-2`
  (card, panel, bar).
- `TableView.pot` **includes the current street's bets**. `raisePresets` in
  `sizing.ts` depends on that: a pot-sized raise is `myBet + call + (pot +
  call)`. The unit test pins it.
- The engine's hand descriptions come from `phe` in Title Case ("One Pair").
  They are lowercased at the display site to match the house voice.
- With no viewer seat (spectating, or a replay) seat 0 takes the bottom slot.
  Only a real `view.you` gets an action bar.
- **`.seat-last` is always rendered**, empty or not. It is a grid column of its
  own, so a label that comes and goes would otherwise shift the clock beside it.
- The felt's inner box is `.felt-in`, not `.ring`: `.ring` is the timer's svg.
- The felt caps its column at 680 px heads-up and 960 px on a ring, and centres
  it, except in `bare` mode (the replay), which fills the card it sits in.
- A six-max match carries no hand count (`format.hands` is null) and the header
  says "Hand 12" without "of". `blindText` adds the level and the countdown to
  the next one whenever `format.levels` holds more than one.
- Reduced motion is respected everywhere: cards stop dealing, chips stop flying
  and ratings stop counting, but every state change stays legible. NumberFlow
  does this itself through `respectMotionPreference`.
- Data tables scroll inside their own `.table-wrap`; the page never scrolls
  horizontally, including at 390 px.
