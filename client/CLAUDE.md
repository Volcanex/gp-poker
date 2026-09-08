# client

React 19 + Vite front end for Open Table. Served by the server from
`client/dist` in production; in development `vite` proxies `/api` and `/ws`
to `127.0.0.1:8130`.

**Owner:** Gabriel Penman
**Design:** g-system, vendored at `public/g/` (`g.css`, `g-ui.js`, `fonts/`).
Never hand-edit those; re-run `node scripts/vendor.mjs` from the g-system repo.
**The mark** is `public/favicon.svg`, a spade on g-system's dark ground with
both colours written as literals (an icon cannot read a custom property).
`favicon-32.png`, `apple-touch-icon.png` (full bleed, iOS applies its own
mask) and the 1200x630 `og.png` link card are rendered from it in a browser,
not drawn by hand: change the SVG and re-render rather than editing a PNG.
The head that a crawler sees is built server side, in `server/src/meta.ts`.

## Run
- `npm run dev -w client` (port 5180, proxies to the server on 8130)
- `npm run build -w client`, then `npx vite preview --port 4173` for the bundle
- `npx tsc -p client/tsconfig.json` typechecks; `npm test -w client` runs the
  unit tests for the pure logic (sizing, labels, showdown reading, replay
  stepping, fairness)
- `npm run e2e -w client` runs the Playwright suite (see **The e2e suite**);
  `npm run e2e:update -w client` rewrites the screenshot baselines

`tsconfig.json` includes `../packages/engine/src/vendor.d.ts`: the client
compiles the engine's TypeScript source directly, so it needs the same ambient
declaration for `phe` that the engine's own tsconfig provides.

## Shape
- `src/net/` — the wire. `types.ts` mirrors the REST payloads, `api.ts` is the
  fetch layer, `adapt.ts` reads the fields the server has not shipped yet,
  `socket.ts` is the single WebSocket, `session.tsx` owns the session, the
  connection state, the queue and the match to return to.
- `src/routes/` — `home.tsx`, `leaderboard.tsx`, `profile.tsx`, `match.tsx`
  (live table, finished summary and the mock), `replay.tsx`. `profile.css` is
  the insights block on a profile: the two small charts (net big blinds by
  seat, where hands end) that g-system does not ship, drawn from the same
  tokens as the rating graph and for the same reason g.chart is not used.
- `src/table/` — the table. `table.tsx` renders one `TableView`; `seat.tsx`,
  `playing-card.tsx`, `turn-clock.tsx` and `dock.tsx` are its parts.
  `result-panel.tsx` is the result under a finished felt and
  `match-summary.tsx` is the page a finished match opens on cold.
  `chip-stack.tsx` draws a denominated stack and `sounds.ts` is the table's
  side of the sound module. `sizing.ts`, `preactions.ts`, `best-five.ts`,
  `chips.ts`, `labels.ts`, `layout.ts` (where each seat sits) and `results.ts`
  (the finishing order) are pure.
- `src/analysis/` — equity, outs and hand names, computed in a web worker.
  `worker.ts` is the only module that imports `@opentable/equity` (and so the
  only one that pulls in `phe`'s half-megabyte lookup table); `index.ts` is the
  main thread's request/response API with cancellation by request id;
  `draw-outs.ts` turns the package's category outs into the number a player
  counts; `live-stats.tsx` is the panel, used as the practice strip.
  `replay-analysis.ts` is the pure half of the replay's analysis panel (what is
  known at a step, what a call cost, the questions the strip needs) and
  `replay-panel.tsx` draws it. See **The replay** below.
- `src/tools/` — the pages at `/tools`. The range explorer and the pot odds
  trainer import the evaluator-free subpaths of `@opentable/equity` and send
  every actual computation to the worker; the opening explorer (`explorer.tsx`)
  is the one tool that reads the server, from `/api/explorer`, because what the
  site itself did preflop is not something a browser can work out.
  `hand-grid.tsx` is the 13 by 13 grid the two grid pages share: it owns the
  layout, the roving tab index and the paint gesture, and the cells are the
  caller's, which is what lets one page paint a range on it and another shade
  it by a frequency.
- `src/puzzles/` — the daily puzzles at `/puzzles`. `chart.ts` reads the
  baseline chart in a browser, `showdown.ts` and `preflop.ts` are the pure
  generators, `store.ts` is the record under `ot.puzzles`, and the three
  `*-page.tsx` files are the pages. See **Puzzles** below.
- `src/replay/` — `to-view.ts` turns an engine `HandState` into a `TableView`;
  `fairness.ts` re-derives the deck and rehashes the commitment.
- `src/ui/` — `auth.tsx` (claim, log in, account menu), `settings.tsx` and its
  pure half `prefs.ts`, `avatar.tsx`, `rating-graph.tsx`,
  `board-text.tsx`, `mode-tabs.tsx` (the heads-up / six-max switch), `bits.tsx`,
  `format.ts`, `title.ts`.
- `src/dev/mock.ts` — the scripted live table, dev only. Both scripts end on a
  showdown and hold it: the heads-up one on a hand you lose, the six-max one on
  the hand that takes the table. That is what the e2e suite drives.
  `?practice=1` stamps `format.practice` over either script, which is how the
  analysis strip is driven without a server.
- `e2e/` — the Playwright suite. `table.ts` is its shared kit.
- `src/app.css` — page layout plus the poker-specific pieces. Tokens only.

## One footprint, three states

The table screen is a column of six grid rows, every one of them placed
explicitly. **Nothing in that column may size to its content.**

| Row | What |
| --- | --- |
| 1 | the spectator's strip, for a viewer with no seat |
| 2 | the hand header |
| 3 | the felt, the only row that takes what is left |
| 4 | the practice table's live stats strip |
| 5 | the dock |
| 6 | the key legend, desktop only |

Two of those rows are optional and an empty grid row is nought pixels, so the
four combinations are one template rather than four, and a strip can only take
room from the felt. Both strips are settled before the first card: who is
watching and whether a table is a practice table cannot change mid-hand, which
is what makes them safe to put in this column at all. The spectator's strip used
to sit outside the grid on the argument that a strip only some viewers see does
not belong in it, which was true of a strip that could arrive mid-hand.
`e2e/footprint.spec.ts` measures every row and asserts they tile the table
exactly.

The rule came from the defect this rebuild started with: the old table mounted
its action bar only when `legal` was non-null, so the felt re-divided the
instant it became your turn and everything on it jumped. The audit caught it in
sixty frames.

The rule is enforced, not remembered: `e2e/footprint.spec.ts` walks the mock
through waiting, your turn, hand over and the next hand at 390 and 1280 in both
shapes, asserts the header, felt, board, pot, hero seat and dock have byte
identical boxes in every state, and asserts the browser's own layout-shift
observer sums to **exactly zero**. It does today. Anything that reintroduces a
shift is a regression, and the usual cause is a box sized to a string:

- Text that changes must sit in a reserved slot. `.hand-head .n` and `.street`,
  `.seat-last`, `.stack-v` and `.pot` all carry a `min-width` or a `width` for
  that reason, and the phone gives `.seat-last` a fixed one because a phone seat
  has no spare width to lend a long label.
- Centred text that changes length moves. `.dock-status` is full width with
  `text-align: center` rather than a box that shrinks to its string.
- A marker that comes and goes moves everything after it. The button `D` is
  always rendered and hidden with `visibility`.
- **`data-state` lives on `.dock-in`, the element that fades, not on `.dock`
  around it.** The dock's own attribute changes the moment the view does, while
  the outgoing content is still on screen finishing its 120 ms exit: with the
  grid rules keyed to the parent, that content spent those 120 ms laid out under
  the incoming state's rows. It was the last layout shift left on the screen.

## The practice strip

A practice table carries one more fixed row between the felt and the dock:
`LiveStats` from `src/analysis/`, reading the hand you hold, the outs and your
equity against that many random hands. It is rendered for the whole match
rather than only while you hold cards, and `.match[data-practice]` gives it a
row of its own (`--stats-h`) and renumbers the dock and its legend, which name
their own rows. The felt gives up the height; the dock never does.

Every reading sits in a fixed cell. The numbers arrive from the worker after
the labels beside them are already painted, so in a flow the note next to a
number slides the moment it lands, and that is a layout shift on the one screen
whose whole rule is that nothing moves. Three widths' worth of detail is
dropped rather than wrapped: the card list and the draw's name go below 1024,
and the note under the equity goes on a phone, leaving one line of hand, outs
and number.

**Outs at the table are draw outs**, not the package's category outs.
`@opentable/equity` counts every card that improves the made hand category,
which is nine for a flush draw and twenty six for an open-ender, because
pairing either hole card improves the category too. Nobody calls that twenty
six outs. `draw-outs.ts` intersects the category outs with the cards the named
draws complete, so the strip says eight, and with no draw at all it drops to a
muted "Improves on N cards" rather than printing a number a player would
misread.

## The dock

One region, one height (128 px desktop, 150 px phone), three states rendered in
the same box and cross-faded at 120 ms with `AnimatePresence mode="wait"`.
Nothing slides.

| State | What is in the box |
| --- | --- |
| `wait` | pre-action pills, and a status line saying who is being waited for |
| `turn` | the sizing presets, the amount field and slider, then fold / check or call / raise |
| `over` | the result line with a countdown, and the three choices as inert outlines that hold the height |

**Pre-actions** (`preactions.ts`) are the reason the waiting state is worth
having. Arm one and it fires the instant the action reaches you: check or fold
checks if it can and folds if it cannot, call any calls, fold to any bet folds
only if somebody bet and checks otherwise, which is what the words say. A pill
that assumed a price is void once the price moves, so any change to the amount
to call clears "check or fold" and leaves the other two armed. The price is read
off the seats by `amountToCall`, because `legal` only exists on your own turn.

The countdown says "next hand in" or "result in" depending on `isLastHand`,
derived from the view the same way the server derives it. Its length is
`HAND_HOLD_MS` **from `@opentable/protocol`**: the server sleeps that hold and
the client counts it down, so it lives in the protocol rather than in either of
them. Two copies of that number drift and the countdown starts lying.

## Sizing

**The typed field is the source of truth.** It holds a raise-to total, opens the
numeric keypad on a phone, and submits on Enter. A number outside the legal
range is clamped **into the field** and not sent: the next press sends the
clamped number, so a size nobody chose never reaches the server. The primary
button always prints the number it will send.

`presetsFor` gives six slots, always the same six in the same order, because the
number keys address them and a preset that moves is a preset nobody learns.
Postflop they are min, a third, a half, two thirds, pot and all in; preflop the
middle three become 2×, 2.5× and 3× the current bet, which is how people size a
raise before a flop. Duplicates are no longer collapsed the way they were when a
preset sent the action: a preset now only writes into the field.

The slider is secondary and desktop only, and it carries no `data-output` bubble
because the field beside it already prints the number. g still owns its fill.

## Hand end

`table.tsx` runs a three-step sequence off the arrival of `result`, and every
step is in the felt, never in the layout:

| At | What happens |
| --- | --- |
| 0 ms | shown cards flip **in place**, 180 ms each, staggered 60 ms. The flip is a remount keyed on face up, which is what keeps it where the card already lies instead of dealing it again |
| 400 ms | the winning five are outlined and the rest of the board dims to 35%, hand names appear beside every seat that showed |
| 700 ms | the pot counts to zero, a chip lands in the award zone and the winner's stack counts up |

`readShowdown` in `best-five.ts` picks the five. The engine already knows them,
but it knows them through `phe`, whose lookup table is why the replay route is
lazy loaded: pulling that in would put 80 kB gzipped back into the bundle
everyone loads to play, so the five are scored here over 21 combinations with no
table. **An uncontested pot reveals nothing and highlights nothing**, because
there is no winning five to point at when only one hand was ever live.

The award chip lands in `.award-zone`, a reserved row under the board. The old
flight targeted the pot badge and landed on top of the pot label.

## When the match ends

`end` no longer replaces the table. The server holds the last hand like any
other, then sends the result; the client keeps the felt rendered and dims it to
70% and slides `ResultPanel` in underneath. Losing a match used to swap the felt
for a summary page one frame after the final hand, so the hand that decided it
was never seen, which is exactly what the owner reported. `e2e/showdown.spec.ts`
samples your cards at four moments through a lost showdown and again after the
end message, and every frame has them face up. It also marks one of them before
the decision and finds the same element afterwards: **your own cards are never
turned over at a showdown**, because they were never face down. Only somebody
else's flip, and the flip is a remount keyed on that, so the hero's cards are
not even redrawn.

A match opened cold from its URL has no felt to keep and still renders
`MatchSummary`. Both share `HandsSection`, which is what "review hands" scrolls
to.

## The e2e suite

`npm run e2e -w client`, config in `playwright.config.ts`, specs in `e2e/`.
The webServer builds the client and serves the bundle with `vite preview`; the
mock routes need no server and `stubApi` in `e2e/table.ts` fakes the three
endpoints the pages around them ask for, so a run is identical whether or not a
dev server happens to be up.

| Spec | Guards |
| --- | --- |
| `footprint` | the boxes and the zero layout shift above, playing and watching, that the dock is one height in all three states, and that the strips tile the grid |
| `ergonomics` | phone target sizes, the primary action in the bottom quarter, the sizing model and clamping, and a pre-action firing |
| `showdown` | your cards face up through a lost showdown and after the end, the winning five, the award chip clear of the pot label |
| `access` | axe-core per state with zero serious or critical, a keyboard-only decision, tab reachability, and typing in the field not triggering the shortcuts |
| `practice` | the strip is on a practice table and off a rated one, that it reads, and that a practice table keeps one footprint with zero layout shift |
| `reduced-motion` | the same information with the motion emulated off |
| `settings` | a choice surviving a reload, the pre-paint stamp, every accent's contrast in both themes, the four colour deck, and the menu itself |
| `screenshots` | 96 baselines: eight states at 360, 390, 430, 768, 1366 and 1920, dark and light |

Baselines live in `e2e/__screenshots__/` and are updated with
`npm run e2e:update -w client`. **Read the diff before you accept one.** The
suite runs with reduced motion so a card mid-deal cannot decide a baseline, and
masks the four things that cannot be pinned to a pixel: the pot figure
mid-count, the depleting turn bar, the seconds beside it and the hand-end
countdown.

The suite runs two workers, not one per core: eight states at 1920 in two
themes is a lot of full-page rendering, and four browsers doing it at once on
this box time out on each other rather than on anything real.

Two things the suite does not cover. The replay page draws a hand fetched from
the API and the suite deliberately runs without one. And the mock has no
uncontested pot, so that rule is pinned in the unit tests on `readShowdown`
instead.

## Settings

One panel in the top bar, `src/ui/settings.tsx`, replacing a button that cycled
the theme: the only way to learn what its third press did was to press it twice.
It is g's `.menu` popover holding g's own controls, so the choices are radio
groups and switches and are labelled as such. A menu role over a set of switches
announces the wrong thing.

**Every setting is an attribute on the root element and every value is in CSS.**
`src/ui/prefs.ts` holds ids and no colours: an accent is `data-accent="jade"` and
`app.css` says what jade is. That is what keeps the pre-paint script in
`index.html` down to three attribute writes with nothing to drift, and it is why
the swatch in the menu can paint itself by carrying the same attribute.

| Setting | Attribute | Values |
| --- | --- | --- |
| Theme | `data-theme` | absent (dark), `light`, `system` |
| Accent | `data-accent` | absent (g's own), `ocean`, `jade`, `violet`, `clay` |
| Four colour deck | `data-deck` | absent, `four` |

All three live in one record under `ot.prefs`. **The theme is written twice on
purpose**: g-ui reads its own `g-theme` key at load and stamps the attribute
itself, so `applyPrefs` writes both in the one call that changes it, and nothing
else in this app calls `g.theme()`. Sound is not in that record: it is a
separate module with its own store and its own key, and playing with the sound
off in a light theme is the normal case rather than a contradiction.

**The accents are not the chart tokens.** Those are step 9 solids meant to sit
under large text, and a 13 px button label on one measures about 3:1. The four
here follow the rebrand card's recipe (a fill, a slightly darker hover and edge,
white on top) and every one of them clears 4.5:1. `e2e/settings.spec.ts` reads
the computed values back out of the stylesheet in both themes and checks the
ratio, so that claim cannot go stale quietly. It reads them through a probe
element rather than off the custom properties, because a custom property whose
value is another `var()` comes back unresolved, and it measures display-p3 where
it is rather than converting it badly: g's palette is p3 and this app's accents
are hex, so both notations turn up.

The four colour deck is four variables, `--suit-s/h/d/c`, read by one rule each
on the card. Diamonds take the palette's blue and clubs its green, borrowed the
same way the red is borrowed and for the same reason: nothing on this felt means
ok or info.

## Chips

`chips.ts` is `denominate(amount)`, greedy over 500, 100, 25, 5 and 1, which is
how a dealer makes change: 137 is a hundred, a twenty five, two fives and two
ones. Greedy over those five also bounds a column, because four ones roll into a
five and three twenty fives into a hundred. A unit test walks every amount a
table can hold and pins it, which is what lets the felt reserve five chips of
height instead of the ten a stack will draw before it starts counting.

`chip-stack.tsx` draws them, and the rule that matters is this: **every
denomination keeps its slot whether or not there is a chip in it, and a column
is a fixed height with its chips on the floor of it.** A chip appears where that
denomination has always been, and the row is the same size at 0 as at 1200. A
centred group whose membership changes moves every member, which is how the pot
counting down to zero was moving the board underneath it.

Three places use it: the bet on the line to the pot (the stack is inside the
element that flies, so the chips travel rather than a badge standing in for
them), the pot, and a mini stack of the big three denominations beside a
player's own number. The mini stack is off on a phone and off on a ring, where
forty two pixels is a name.

## Sound

The module is `src/sound/` and belongs to another workstream; the table's side
of it is `src/table/sounds.ts`, one hook driven by the same view everything else
is drawn from. Nothing there asks whether sound is on: the module returns
immediately when it is off, and a pack is only fetched once something plays.
Every effect keys on the hand and action sequence, which is what stops a
re-render replaying the last thing that happened. The first pointer or key
event anywhere unlocks the audio context (`useSoundUnlock` in `app.tsx`),
because a browser will not let a page make a noise until somebody has touched
it.

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
  container.
- **Below 640px the ring gives up and the felt goes portrait.** Six seats
  across a 366 px felt leave 120 px each, which is not a seat: the ellipse was
  truncating every name and the avatar had been dropped to buy room. So the
  felt becomes four rows instead, the way a phone poker client has always done
  it: the players furthest round the table along the top, your two neighbours
  under them either side, the board across the middle, and your own seat across
  the bottom at the size every other table draws it, because your two cards are
  the ones you have to read. `portraitSlot` in `layout.ts` says which cell each
  seat takes and is unit tested; the CSS under the container query is mostly
  undoing the ellipse's absolute positioning. Row 1 is empty at three and four
  seats, and an empty grid row is nought pixels, so four rows draw every table.
- **On that felt the bet sits on its seat's own inner edge**, facing the board,
  rather than flying toward the middle: every seat is nearly touching the pot at
  that width, and a chip aimed at it landed on the label.
- **Two things hang off the seat rather than sitting in it there**: the dealer
  button on the top right corner and the avatar on the top left. Out of the flow
  they cost no width, which is what buys the name back, and they still cannot
  shift anything by arriving.
- **Dealing.** `dealOrder` is round robin from the seat left of the button, one
  card each then the second, which is the order the engine deals in; the seat
  passes it to `PlayingCard` as the stagger index. In ring mode each card also
  starts from the middle of the table, so cards fan outwards.

`SeatView.out` seats render dimmed to 45% with their place ("4th") where the
stack would be, and `SeatView.bot` gets a small mark beside the name.

**A ring seat is 264 px and everything on it is fighting for that width**:
cards, an avatar, a name with up to three badges, a stack, a hand name and a
clock. Three things give way rather than the name, which is the identity: the
rating (a click away on the profile the name leads to), the word "units" (every
number on this felt is in units, and "all in" still shows), and on the narrowest
ring the avatar itself. A name that still does not fit truncates with its full
text in the title.

## Ratings are per mode

A six-max result never moves a heads-up rating, the way a chess site keeps
bullet and blitz apart. `UserSummary.ratings` is a `ModeRating` per mode and it
is the real answer; the flat `rating`/`rd`/`provisional` on the wire are the
heads-up standing, kept for compatibility. **Nothing outside a match reads the
flat fields.** `modeRating(summary, mode)` in `adapt.ts` is the only way in,
and it falls back to the flat fields for heads-up so the client keeps working
against a server that has not shipped the map. Every other mode then reads as
never played rather than borrowing the heads-up number.

`ratingHistory` is one line per mode for the same reason, and
`ratingHistoryFor()` reads a flat array as the heads-up line. `/api/leaderboard`
takes `?mode=`, one ladder each. `modeWinRate()` counts wins over decided
matches with draws in the denominator, which is how the server computes the one
flat win rate it sends, so the two can never disagree on screen.

Each standing carries its own `peakAt`. `modePeakAt()` falls back to the flat
`peakAt`, which is the heads-up one, for a server that predates the field, and
says nothing for any other mode rather than borrowing that date.

**A casual match still comes back with a ratings map**, unchanged on both
sides. None of it reaches the result screen: no rating, no delta, no deviation,
just one muted line under the heading saying there was no rating change. The
gate is `match.rated`, not whether a rating happens to be there.

Where the mode comes from on each screen:

| Screen | Mode |
| --- | --- |
| top bar | `queue.mode`: the mode last played or chosen |
| home cards | each card shows its own mode |
| home top ten | `queue.mode`, so the board matches the button above it |
| leaderboard | its own tab, opening on `queue.mode` |
| profile standings | both, one row each |
| profile rating line | its own tab, opening on whichever mode has more matches |
| seat, result panel | the match's own mode, which the server already resolved |

A mode with no rated matches says so rather than showing the 1500 everyone
starts on as though it were earned.

## Puzzles

Three pages under `/puzzles`, plus a card pointing at the pot odds trainer,
which is the fourth puzzle and stays where it is rather than being duplicated.

**Nothing here is a solver, and no puzzle is asked whose answer would need
one.** Who wins is settled by the evaluator that settles pots, through a
`showdown` request to the analysis worker (`analysis/showdown-solve.ts` is the
only puzzle module that touches `@opentable/equity`'s root, so `phe` stays out
of the bundle everybody loads). The preflop spots are graded against the
baseline charts, which are heuristic, and every page says so under the answer.

**Difficulty is structural, not measured.** A harder showdown is not one the
generator scored and found close, it is one whose shape makes it close: every
hand pairing the same board card, a board paired above everybody, or a board
straight nobody can beat so the pot splits. That is what keeps the generator
pure and the answer the evaluator's. The preflop ramp is the distance from the
hand to the nearest chart cutoff, which narrows as the streak grows.

**`puzzles/chart.ts` goes through `@opentable/preflop` directly.** The
package reads its two JSON files with static imports now, so it is pure and
isomorphic and safe to import here; `chart.ts` re-exports its ranking, region
and scoring functions rather than recomputing them, and only keeps the
puzzle-specific copy (`SPOT_COPY`, `BUCKET_WORDS`, `SPOTS_BY_BUCKET`) local.
`src/test/puzzles.test.ts` still checks every bucket, spot and hand class
against the real package by name — now mostly a regression pin against a
future edit reintroducing a local copy, rather than a guard against an
existing one. `src/routes/learn/chart-data.ts` does the same for the lesson's
grid.

`/puzzles/hand` is lazy loaded because it replays a stored hand with the
engine, the same reason `/m/:id/h/:n` is. The server does the walk that finds
the decision (`GET /api/puzzles/hand`) and the page replays the log up to the
index it names, so the pot and the price on screen are the engine's answer
rather than numbers the server wrote down.

The record is one object under `ot.puzzles`: a streak, best streak and count
per type, plus the day and the number solved on it. The pot odds trainer keeps
its own older record under `ot.odds` and keeps it there.

## Routes
| Path | Page |
| --- | --- |
| `/` | queue, how it works, top ten |
| `/leaderboard` | top 100 |
| `/u/:name` | profile |
| `/watch` | live tables, and the ones that just finished |
| `/c/:id` | a friend's challenge link: who is challenging you, the format, one button that starts the match |
| `/m/:id` | live table while playing, spectator seat if you have none, result summary once finished |
| `/m/:id/h/:n` | hand replay, scrubber and fairness checks |
| `/puzzles` | the puzzle index and the daily count |
| `/puzzles/showdown` | who wins a finished board |
| `/puzzles/preflop` | one spot from the baseline chart |
| `/puzzles/hand` | a real preflop decision, replayed to the moment it was made |
| `/m/mock` | the scripted table, dev only (`?step=N` freezes one moment, `?mode=six-max` runs the six-handed script, `?watch=1` drops the seat) |

`useTitle` (`src/ui/title.ts`) sets the document title per route and appends
the product name, so it is spelled in one place.

## Watching

`/watch` lists the live tables from `/api/live` on a five second clock, with
`/api/recent` under it. A row opens `/m/:id` like any other match link, and
whether that is a table or a spectator seat is the server's answer, not the
route's: `view.you == null` is the whole test. Watching adds a strip above
`.match` carrying the badges and who is playing, a fourth dock state (`watch`)
holding the live status and the way out, and an empty key legend, because a
spectator has no keys to press. **None of it is a row of `.match`'s grid**:
the header, the felt and the dock keep one box in every state, and the strip
sits outside that column so the felt is unchanged. `/m/mock?watch=1` runs the
mock script with the seat removed, which is how the watching table is
screenshotted without a live match.

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

**Fields that are pending, transitional or shaped two ways go through
`src/net/adapt.ts`**, never read directly: mean preflop accuracy on
`/api/users/:name`, per-seat accuracy on the hands list of `/api/matches/:id`,
a seat's bot flag, `place`/`players`/`rated` on a profile's match history (a
placing needs both halves before "1st of 6" can be said at all), a hand row's
`live_seats`, and the per-mode readers (`modeRating`, `ratingHistoryFor`,
`modeWinRate`, `modePeakAt`). That file is the single place to change when the names are
confirmed, and the UI above it never learns a name. Absent and null both mean
"no number", and the caller hides its tile or column rather than printing a
zero; a real zero (a hand scored 0% accuracy) still shows, which is why the
adapter tests distinguish the two.

One thing the endpoints do not carry, left out rather than invented:
**per-hand study on the match page** beyond the accuracy column. The full
decision list lives on the replay page, which has the hand row. (A match count
per player used to be missing too; `summary.ratings` carries one per mode now.)

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

**The analysis panel** under the felt reads every seat it is allowed to see at
the step on screen: the hand's name, its equity and, on the flop and the turn,
its outs, with a strip under it of equity across the streets. What it may read
is the felt's rule and not a quieter one of its own: your own cards if you
played the hand, everybody's once the step reaches a showdown, and everybody's
at any step while "show all cards" is on. Stepping back before the showdown
takes the numbers away again, which is what stops a replay telling you what
somebody held before they showed it.

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
   and stamps it so a second pass is a no-op. Note it passes the *wrapper*: g
   looks for its components inside the node it is given, never at the node
   itself. Three nodes are co-owned: the `.copy-btn` in the hand header (g
   inserts icons and rewrites the label on click), the account `.menu` (g
   positions it and binds its items) and `.tabs` in `mode-tabs.tsx` (g owns
   `aria-selected`, the roving tab index and the sliding indicator, and handles
   the arrow keys itself). Their React children must stay constant. The menu
   handlers call `hidePopover()` themselves so a re-rendered item still closes
   the menu; the tabs render `aria-selected` from the mode they mounted with,
   which React writes once and never touches again, and read the selection back
   out of the DOM on click and on key up rather than setting it.
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

A fifth thing, added with the dock: **a button is restyled through g's own
slots.** The inert ghosts in the hand-over state set `--_fill`, `--_fg` and
`--_edge` and take a dashed border, rather than being dimmed copies. A button at
40% opacity is a button nobody can read, and axe says so.

The accent slot is not overridden. g's default accent is the far end of the
neutral scale, and that is the one accent this app uses: the acting seat's
border and clock bar, the winning five at a showdown, the primary action, your
own row on the leaderboard. A rebrand
would set `--accent-fill/-hover/-fg/-edge` and nothing else.

## Keyboard
| Key | Where | Does |
| --- | --- | --- |
| `f` | your turn | fold |
| `c` | your turn | check, or call |
| `r` | your turn | focus the amount field, from anywhere |
| `1` to `6` | your turn | write that preset into the field |
| Enter | the field | send the raise, or show the clamp |
| left, right | replay | step back, step forward |

The legend under the dock is desktop only, and it says the same thing in every
state: a line that comes and goes is a line that moves the felt. `r` works while
typing (it is how you get back to the field); every other shortcut is blocked by
`isTextEntry`, so typing 137 into the field does not fold the hand.

## Bespoke components (promotion candidates for g-system)
Poker-specific pieces live here only because g has nothing close. If one stops
being poker-specific, build it in g-system, not here.

- **`playing-card.tsx`** — rank and suit on a surface, plus face-down and
  empty-slot states. The empty slot holds the board's width so nothing shifts
  as streets arrive. Red suits use `--danger-text` as the palette's red;
  nothing destructive in this app is red (Fold is `btn-tertiary`), so the
  meaning colour is not overloaded. **Promotion: no, this is poker.**
- **`turn-clock.tsx`** — a countdown driven by a server deadline rather than a
  local duration, so a reconnecting client lands on the right remaining time. It
  draws the depleting bar along the acting seat's top edge and the seconds
  beside its last action. It replaced a 20 px ring at the far corner of the
  seat, which the audit found people missed. **Promotion: yes.** g ships
  `.g-progress` and `.g-meter` but nothing that counts down.
- **`seat.tsx`**, **`dock.tsx`** — poker furniture. The dock's "bounded number
  with presets, a typed field and a slider, all clamped to one range, in a box
  that never changes height" is the generic half; the poker words are not.
  **Promotion: partly.**
- **`best-five.ts`** — a five card evaluator that exists only to avoid pulling
  `phe` into the bundle everyone loads. **Promotion: no**, this is poker, and
  the engine is the real evaluator.
- **`rating-graph.tsx`** — a single line over time. g ships `g.chart`, but it
  draws into a node it owns and re-renders by being called again, which fights
  React. **Promotion: yes**, as a React-friendly sparkline. Note the line
  stretches to its box (`preserveAspectRatio="none"`) and holds its width with
  `vector-effect`, which is why it has no marker: a circle would stretch into
  an ellipse.
- **`board-text.tsx`** — cards as text for dense tables. **Promotion: no.**
- **`chip-stack.tsx`** — denominated chips. **Promotion: no, this is poker**,
  though the fixed-slot idea behind it (a member that appears takes a place that
  was already there) is worth stealing anywhere a group can change size.
- **`ui/avatar.tsx`** — not bespoke: it is g's shipped `.avatar` with its size
  adjusted through `--avatar-size`, around the deterministic SVG from
  `@opentable/identity`. 28 px at a seat, 24 px in a row, 56 px on a header.
- The replay scrubber, action list and fairness panel are page furniture, not
  components. **Promotion: no.**

## Gotchas
- There is no `--surface` token. Use `--surface-1` (page) and `--surface-2`
  (card, panel, bar).
- **`--text-placeholder` is for the hint inside an empty field, nothing else.**
  It measures 3.68:1 on the page ground and 3.43:1 on a panel, below AA for
  anything a reader has to read, and axe says so. Everything in this app that
  carries information is `--text-secondary` (9:1): the preset amounts, the key
  legend, the "you" badge, the mode beside your rating, a rating deviation, a
  side pot, the replay's hints and notes. The only use left is a background, on
  the paused clock bar. `--text-muted` is not a third step, it is an alias of
  `--text-secondary`.
- **A NumberFlow's digits live in a shadow root as a reel**, so reading one as
  text reads `0123456789`. Assert against something in plain markup instead. Its
  host is `display: inline-block`, which is why the pot's counter is given
  `display: block; width: 100%`: a counter that resizes itself is a counter that
  shifts everything beside it.
- The stack is `useGrouping: false`. A grouped `1,200` is five characters in a
  four character slot, and it moved the word beside it.
- **Generated names are CamelCase** (RedTiger, StealthyCyclone), so a plain
  ellipsis cuts a word in half. `shortName` drops whole words instead and the
  seat keeps the full name in its title.
- An avatar is seeded from a user id, never a name: a name can be claimed and
  changed and the picture should not change with it. `avatarSeed` in `adapt.ts`
  falls back to the name for a row written before the server sent ids.
- `TableView.pot` **includes the current street's bets**. `presetsFor` in
  `sizing.ts` depends on that: a pot-sized raise is `myBet + call + (pot +
  call)`. The unit test pins it.
- The engine's hand descriptions come from `phe` in Title Case ("One Pair").
  They are lowercased at the display site to match the house voice, which is
  also why `readShowdown` lowercases the name it takes off an award.
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
