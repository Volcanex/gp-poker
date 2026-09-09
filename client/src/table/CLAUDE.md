# table

The felt. `table.tsx` renders one `TableView` and everything here is a part of
it: `seat.tsx`, `playing-card.tsx`, `turn-clock.tsx`, `chip-stack.tsx` and
`dock.tsx` on a live table, `result-panel.tsx` under a finished one and
`match-summary.tsx` for a match opened cold from its URL. `sizing.ts`,
`preactions.ts`, `best-five.ts`, `chips.ts`, `labels.ts`, `layout.ts`,
`sitout.ts` and
`results.ts` are pure and unit tested from `../test/`. `sounds.ts` is the
table's side of `../sound/`.

**One thing moves at a time on the felt.** What moves: the deal, a showdown
flip, the winning five's outline, chips ticking between stacks, and the award
line's wipe. Nothing else. No figure rolls, nothing fades, no colour
transitions, nothing flies. The owner's complaint that this rebuild answers
was "overlapping animations" and "the eyes don't know where to look", and
every animation that is not on that list is one more thing asking to be
looked at.

## One footprint, three states

The table screen is a column of six grid rows, every one of them placed
explicitly in `../app.css`. **Nothing in that column may size to its content.**

| Row | What |
| --- | --- |
| 1 | `.watch-bar`, the spectator's strip |
| 2 | `.hand-head`, the hand header |
| 3 | `.felt`, the only row that takes what is left |
| 4 | `.practice-strip`, the practice table's live stats |
| 5 | `.dock` |
| 6 | `.dock-keys`, the key legend, desktop only |

Rows 1 and 4 are optional and an empty grid row is nought pixels, so the four
combinations are one template rather than four, and a strip can only take room
from the felt. Both strips are settled before the first card: who is watching
and whether a table is a practice table cannot change mid-hand, which is what
makes them safe to put in this column at all. The spectator's strip used to sit
outside the grid on the argument that a strip only some viewers see does not
belong in it, which was true of a strip that could arrive mid-hand.

The rule came from the defect this rebuild started with. The old table mounted
its action bar only when `legal` was non-null, so the felt re-divided the
instant it became your turn and everything on it jumped. The audit caught it in
sixty frames.

The rule is enforced, not remembered: `../../e2e/footprint.spec.ts` walks the
mock through waiting, your turn, hand over and the next hand at 390 and 1280 in
both shapes, asserts the header, felt, board, pot, hero seat and dock have byte
identical boxes in every state, and asserts the browser's own layout-shift
observer sums to exactly zero. It does today. Anything that reintroduces a
shift is a regression, and the usual cause is a box sized to a string:

- Text that changes must sit in a reserved slot. The pot's figure has the
  pot's fixed width, `.stack-v` a `4ch` minimum, the action square is a
  square, and every stats row's value is a grid cell.
- **A text node that changes inside a centred or right-aligned box moves**,
  as far as the layout-shift observer is concerned: the box holds still and
  the ink does not. Every figure on the felt that changes in place is keyed on
  its value (`key={potShown}`, `key={seat.stack}`, the stats values), so a
  new number is a new node, which the observer treats as content arriving
  rather than moving. The seconds in the action square are the exception
  because `turn-clock.tsx` is not this directory's to key: they are
  left-aligned in a `4ch` box instead.
- A marker that comes and goes moves everything after it. The button `D` is
  always rendered and hidden with `visibility`, and the flag beside a name is
  the same bargain in a different shape: `FlagSlot` (`../ui/flag.tsx`) draws
  either the picture or an empty box of exactly its size, so a seat with a
  country and a seat without measure the same. The hairline is drawn inside the
  box for that reason.
- **A reserved slot has to be paid for somewhere.** Half a phone is 179 px
  and a name is what a seat is read by, so on a phone the line gives
  everything else up: the avatar goes, the empty flag slot goes (a seat's flag
  cannot change mid-match, so hiding the empty box moves nothing), the bot
  badge drops to the stack line (drawn twice, CSS keeps one) and the button
  goes to the seat's corner, out of the flow. `../../e2e/ergonomics.spec.ts`
  is what holds the names whole at 768 and up.
- **`data-state` lives on `.dock-in`, the element that fades, not on `.dock`
  around it.** The dock's own attribute changes the moment the view does, while
  the outgoing content is still on screen finishing its 120 ms exit: with the
  grid rules keyed to the parent, that content spent those 120 ms laid out under
  the incoming state's rows. It was the last layout shift left on the screen.

## The dock

One region, one height (128 px desktop, 150 px phone), three states rendered in
the same box and cross-faded at 120 ms with `AnimatePresence mode="wait"`.
Nothing slides. A spectator gets a fourth, `watch` (see `../routes/CLAUDE.md`).

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

## The hero band

v2 replaces the dock with `hero-band.tsx` at every width: a decision line along
the top edge, and under it your own two cards drawn large in one bottom corner,
the controls in a column under the thumb in the other, and on a screen wide
enough, the key legend under the controls. **The phone layout is the shape and
the desktop one is it scaled up**, which is why this is one component and one
stylesheet rather than two; `hero-band.css` is written wide first and the phone
overrides it at the foot of the file. v1 never sees any of it, and the rules are
scoped to `.hero-band` and `.match[data-band]` so it cannot.

| | Phone | Wide |
| --- | --- | --- |
| Band height (`--band-h`) | 264 px | 224 px |
| Decision line (`--hb-line-h`) | 28 px | 28 px |
| Card | 104 px | 76 px |
| Hand column | the fan's own width | the fan's own width |
| Action column | 176 px | the rest of the felt's column |
| Sizes | six, two rows of three | six, one row |
| Actions | three rows: bet, call, fold | two groups: fold and call, then bet |
| A size of your own | the sweep sizer | a typed field, key `r` |
| Key legend | none, there is no keyboard | one line under the controls |

**The band's ground is the page's and its content is the felt's.** The ground
runs the full width, because a band that stopped where the felt does would be a
floating panel; `.hb-line` and `.hb-in` inside it are capped at `--felt-w` and
centred, so the cards start on the felt's left edge and the controls end on its
right one. `--felt-w` is declared on `.match` (as well as on `.felt`) for exactly
this, and `table.tsx` stamps `data-mode` on both.

**One line says the decision.** `DecisionLine` is the band's top row: one
sentence, the clock or the countdown at its right end, and the clock's bar as
its floor. On your turn it says the price ("34 to call", "Check or bet", "All
in to call") with your seconds; waiting, who is being waited for ("riverrat to
act") with their seconds and their bar drawn in the placeholder grey rather
than the accent, so the bar reads as information rather than as a call to
action; at hand end, who won what ("You win 132 with flush, king high") with
"Next hand in 3" or "Result in 3" off `isLastHand`; watching, "Watching,
riverrat to act". **It is the only status the band prints.** The band used to
say what was happening in three places, a pot note over the sizes, a status
line under the pills and a result line with a countdown badge, and a player
looking for the decision had to read all of them; the owner's word for it was
confusing. The words snap, the row is one height, the end slot is a fixed 96 px
(a slot that grew for "Next hand in 4" moved its own left edge, and the
footprint audit caught it), and the bar is drawn empty when no clock is running
so the floor is there in every state. `resultText` and `decisionText` are
exported from `hero-band.tsx`; the dock's `HandResult` stays for v1.

**A held hand offers the deal in the countdown's slot.** A practice table
holds a finished hand until the viewer deals on: `view.hold === 'you'` with an
`onNext` prop (passed through `Table`) puts a primary "Deal the next hand"
button at the line's end, Enter or N press it, and the countdown is not drawn.
The button is wider than the 96 px slot, so it is anchored to the slot's right
end out of the flow and the words are padded clear of it: a slot that grew
would move the line. The mock's `?hold=1` marks every hand-over step held.

**Sitting out is a state of the band, in front of your turn and of waiting.**
A seat the room has sat out arrives with `sittingOut` on it, and while it is
true the decision line says "You are sitting out. Press to come back" and the
controls column is one press, `Come back`, standing in the actions' own box
(`.hb-back-btn` spans it at both sizes and sits at `--act-h` in the middle of
it, so the band does not move and a phone does not get a button three rows
tall). It does **not** stand in front of the hand being over: who won is worth
reading, and the prompt is back the moment the next hand deals. A spectator has
no seat to sit out. One button and not three disabled ones, because fold, check
and raise are not what is on offer: the only decision a sat-out player has is
whether to be at the table at all.

`data-sitout` is stamped on `.hero-band` beside `data-state`, which stays what
it was, so the state the footprint suites walk is unchanged and the sit-out
prompt is a thing they can wait for on top of it. `sitout.ts` holds the rule and the words, pure and
on its own so `../test/table.test.ts` can test them without a felt.
`../routes/match.tsx` sends
`{t:'back', m}` from the button, and by itself on the two edges that mean the
player has returned: a socket that has just reopened, and a tab that has just
come to the front. It is deliberately **not** sent for as long as the page is
connected and sitting out, which would un-sit an idle player the instant the
table sat them out; the room ignores a `back` from a seat that is not sitting
out, so the edges can fire without the page having to know. `/m/mock?sitout=1`
marks your own seat sitting out, the way `?hold=1` marks a hand held.

**The band is your seat at every width, not only on a phone.** The felt drew
your cards, name, button marker, stack, last action, avatar, rating and clock,
and the band drew most of them again a hundred pixels below; the rule that hid
the felt's copy has left the phone media query for `look-v2.css`. The clock came
with the rest of the seat and is now the decision line's: `TurnBar` under the
words and `TurnSeconds` at their end. The avatar and the rating did **not** come
with it: the avatar is decorative and aria-hidden, and the rating is on the
profile the name links to, which is the same trade the felt's seats make.

**Your stack is `table.tsx`'s reading, not the band's.** `HeroBand` takes it as
a prop because at hand end it is held at what it was until the pot has actually
moved, which is the same hold the felt puts on every seat's figure: a result
message arrives 700 ms before the chips get there, and a band reading the view
straight printed the number you won while the pot was still in the middle. Two
readings of when a hand is paid is two readings that drift, so there is one, in
the place the felt already reads it. Nothing counts up: every figure on the
felt snaps, and the band's takes a reserved `4ch` and changes in one step.
**The chips beside it are the thing that moves**: a `ChipStack` of the big
three denominations stands after the figure, in `.hb-chips` at 18 px, and it
ticks one chip per column per 60 ms when the stack changes, the way every stack
on the felt does. Every denomination keeps its slot, so the last action after
the chips does not move.

**One left edge for the corner.** The cards, the name line, the stack, the
chips and the last action all start on the felt's left edge. The figures used
to be set in by the flag's reserved box so they lined up with the name's first
letter, which put three edges in a corner that needs one; the flag now stands
on the shared edge and the name reads as indented behind it.

**Three actions, three colours, and each is disabled where it is not legal,
never dropped.** Fold, check or call, and raise are `.btn`s in `.hb-acts`, one
row under a mouse and a column under a thumb (the phone reorders them with
`order` so raise is at the top and fold on the bottom edge). Each takes its
colour from the action tokens `../app.css` declares (`--act-fold`,
`--act-call`, `--act-bet` and their `-text` pairs), mixed thin for the ground
with the text token for the words, so the three read as three at a glance
without three solid blocks at the foot of the screen. The Raise button opens
the way to a size, which is the sweep on a phone and the typed field on a wide
band; it does not send, because a raise needs a number and the sizes are where
the number comes from. Fold was a slide; the owner cut it, and a slide's
pointer capture, handle, hatched track and threshold went with it.

**Six sizes, and they are fractions of the stack.** The band's raise control
is `presetsStack`'s six at both widths: Min, a tenth, a quarter, a half, three
quarters and all in **of what the player has**, which is `legal.max`, the
engine's own `seat.bet + seat.stack`. The same six before the flop and after
it, so the key under a finger means the same thing on every street. The old set
was ten pot fractions in two rows that changed shape at the flop, and the
owner's note on it was three separate complaints in one breath: too many
buttons, too many numbers, and every size about the pot rather than about the
stack.

**A box says its amount and nothing else**, in the table's tabular numerals,
with its key drawn faintly in the top left corner (`--act-bet-text` mixed to
55%, which is a reminder for a hand already on the keyboard rather than a
label). What the size is called is in the title. A box that would say a number
another box already says is **drawn blank and disabled** (`dupKeys`: the ends
own their numbers, so all in is always the last box and always says the stack),
kept in place rather than dropped, because the keys address the boxes by
position; a blank box is `aria-hidden` so it is not a button with no name.

**A box loads the button, and the button sends.** Pressing a box, or its number
key, puts that size into the Bet or Raise button under it ("Raise to 250",
verb-first, the words keyed on themselves so a changing string is not a text
node moving in a centred box); the button and Enter are the only things that
send. The old grid sent on one press of a number key, which is a stack in the
middle on a mistyped digit. **A decision opens on Min**, not on the quarter: the
loaded size is what Enter sends. `r` opens a size of your own, which is a
typed field in the sizes' own box under a mouse and the sweep under a thumb,
and **that** starts from the quarter (`DEFAULT_PRESET`, stepped up past a blank
box by `openAt`). The typed field clamps into itself and does not send, exactly
as the dock's does. There is no mouse-only way to the typed field: the button
had to become the send, so `r` and the legend are how it is found.

**Two groups under a mouse, one stack under a thumb.** Wide, the controls split
left and right: fold and check or call on the left in `--acts-w`, the six sizes
directly over the button that sends one on the right. That is a row shorter
than the two rows of five, which is where the band's 40 px came from: **the
card size sets the band's height**, not the controls, so the cards came down to
76 px with it and the felt took the difference back. On a phone the same pieces
stack: the six as two rows of three, then bet, then call, then fold on the
bottom edge under the thumb, and a box there opens the sweep on itself rather
than sending, because a box that small under a thumb is worth confirming.

g-system ships no segmented control, so `.hb-sizes` is composed from `.btn`'s
own tokens. **It is a g-system candidate and belongs there**, not here.

**A spectator's band is 176 px at every width.** The height a band is is the height
two giant cards and a thumb's column need, and a spectator has neither; the felt
still draws the bottom seat, because it belongs to a player. Whether you are
watching is settled before the first card, the way a practice strip is, so this
is still one box and one height for as long as the table is on screen.

**The dock's rule holds, and the band is a harder case for it.** One box, four
states, nothing sized to its content: `../../e2e/hero-band.spec.ts` walks a hand
through turn, waiting, hand over and the next turn at 390 and 1280, in both
shapes of felt, and asserts the header, the felt, the board, the pot and the
band have byte identical boxes and that the layout-shift observer sums to
exactly zero. The felt's own footprint list cannot be used, because the
band **is** your seat: `.match[data-band]` drops the felt's bottom row
(`.pos[data-k="0"]`) at every width, and drops the grid track it would take.
`data-band` is stamped by `table.tsx` only when the band is on screen **and**
the viewer has a seat, because a spectator's bottom seat belongs to a player
and hiding it would leave a hole.

The controls column is one grid in every state (`.hb-turn`: slack, sizes,
actions, as named areas), so the waiting pills and the hand-over ghosts stand
in the actions' own boxes and the control a thumb is resting on when the hand
ends is where it was when the next one deals. The only shift this band has had
inside that box was the last-action slot: it is empty for most of a hand, an
empty box has no baseline of its own, and the phone's row was aligned on one,
so the label jumped four pixels the moment a word arrived in it. The row is
aligned to its bottom edge instead.

**The legend leaves the table's grid on v2.** `KeyLegend` takes a class name and
a `sizes` count, and the band renders it into a row of its own under the
controls, so row 6 is empty and the felt gets those pixels back. v1 keeps the
row untouched and its six. It is `--text-secondary` rather than the placeholder
grey, because the placeholder measures 3.68:1 on this ground and this is text a
person reads.

**The table is one screen and never the page's scrollbar.** `.match` is capped
at `calc(100dvh - var(--top-h))` unless it is bare or ended, so a window too
short for the felt shortens the felt, which is the only `1fr` in the column and
scrolls its own overflow. Without the cap the column simply grew, because
`#root` is a `min-height`: measured on a 1366 by 768 laptop, a practice table
was a 903 px document in a 768 px window and the controls were under the fold.
The felt pays for the rest: the band drops the felt's bottom row and its track,
and `look-v2.css` takes the felt's padding in one step. The grid never
squashes: every track is fixed, so a window too short for it scrolls the felt.
The decision line's 28 px came out of the felt too, and at 1366 by 768 both
shapes still fit without a page scrollbar (the spec pins it).

| At 1366 by 768, practice table | Before | After |
| --- | --- | --- |
| Document height, heads-up | 903 | 768 |
| Felt | 521 | 410 |
| Band | 260 | 236 |

The board's own row cost the felt 64 px, and the wide band gave 40 of them back
by dropping to 224. Measured on the mock at 1366 by 768: the band went 264 to
224, the felt row 416 to 456, and the felt's content 196 to 260. Neither shape
scrolls and there is still no page scrollbar.

**The mock's caption stands above the band, and the mock places it.** It printed
over the hero's cards, which are the one thing on this screen you have to be
able to read. It stays fixed and out of the flow, so it is still no part of the
footprint the tests measure, and `../routes/match.tsx` adds up `--band-h`,
`--band-watch-h` and `--strip-h` to lift it: only the mock knows which rows its
table has, and a `:root:has()` rule to work it out would be a whole document
selector running on every page in the app to place a caption on one.

**The band sits on the page's gutter, not its own.** `--band-gut` is 16px wide
and 12px on a phone, which is what the felt, the hand header and the dock this
replaces already use. `--band-pad` is the vertical padding only, and the gap
between the decision line and the content, so changing the gutter cannot move
a row.

**The sizer is g's slider stood on end, plus a sweep.** The rail is 4 px with
the part below the thumb in the accent, exactly as `.g-slider` draws it lying
down; the thumb is a 22 px circle with the control border. What is bespoke is
only the gesture: pressing anywhere in the column jumps to that point and drags
on from there, so a size is one thumb movement, and the hit area is the whole
column and draws nothing. Min is at the bottom and all in at the top, the way a
stack reads. The `input type=range` under it is invisible and carries no pointer
events: it is there for a keyboard and a screen reader, and the hit area owns
the gesture. Only three marks are drawn, and one that lands within 8% of another
is dropped, because half a short stack is often all in or nearly it and two
labels three pixels apart say less than one.

**The keys are the dock's keys**, not a second copy: `useTurnKeys` in
`dock.tsx` owns them and takes two callbacks, one for `r` and one for the number
keys, which hand over the whole preset so the band can refuse a disabled one.
In the dock they focus the field and write into it; here they load a box into
the button, or open the sweep on it. Enter sends what the button says: on a
phone it lives in the sizer, because there a size is only open while the sweep
is, and on a wide band it is a window listener that stands aside for the typed
field's own Enter. The clamp and all-in semantics come from
`raiseAction` and `raiseLabel` in `sizing.ts`, which the dock's `submitRaise`
also calls.

**The fan's box is the fan's real bounds**, not the pair's. A card rotated about
its bottom left corner reaches up past the top of the pair by its width times
the sine of the tilt and out past their right edge by its height times the same,
so a box drawn to the cards' own size was eleven pixels shorter and sixteen
narrower than the thing inside it, and the tilted card crossed the band's top
edge and the column beside it. `--fan-sin` is written out for that reason. The
cards rest on the floor of the box and the slack is at the top, which is where
the tilt goes.

**Handedness is a setting** (`hand` in `../ui/prefs.ts`), stamped as
`data-hand="left"` on the root by the pre-paint script in `../../index.html` as
well as by `applyPrefs`, so a left handed player never sees the right handed
layout flash past. The band mirrors by swapping its grid areas at both sizes,
the fan tilts the other way and the sweep moves to the near edge. **The fan
also stacks the other way round**: a card's rank is in its top left corner, so
mirrored, the second card lands over the first one's rank and a left handed
player could not read the card they were dealt first. The tilted card is lifted
by its own width times the sine of the tilt, because a card rotated about its
bottom corner drops the far one off the bottom of the band and onto the page.

## Sizing

**The typed field is the source of truth.** It holds a raise-to total, opens the
numeric keypad on a phone, and submits on Enter. A number outside the legal
range is clamped **into the field** and not sent: the next press sends the
clamped number, so a size nobody chose never reaches the server. The primary
button always prints the number it will send.

`presetsFor` is **v1's dock only** now: six slots off the pot, min, a third, a
half, two thirds, pot and all in, with the middle three becoming 2x, 2.5x and
3x the current bet preflop. It depends on `TableView.pot` **including the
current street's bets**, so a pot-sized raise is `myBet + call + (pot + call)`;
the unit test pins it. `presetsStack` is the band's six and depends on nothing
but `legal` (see the band, above), which is why it is the same six on every
street.

`dupKeys` says which boxes repeat a number. It matters on the band, where a box
is a choice rather than a write, and not in the dock, where a preset only fills
a field.

The slider is secondary and desktop only, and it carries no `data-output` bubble
because the field beside it already prints the number. g still owns its fill
(see `../ui/CLAUDE.md`).

## Hand end

`table.tsx` runs a three-step sequence off the arrival of `result`, and every
step is in the felt, never in the layout:

| At | What happens |
| --- | --- |
| 0 ms | shown cards flip in place, 180 ms each, staggered 60 ms. The flip is a remount keyed on face up, which is what keeps it where the card already lies instead of dealing it again |
| 400 ms | the winning five are outlined and the rest of the board dims to 35%, hand names appear beside every seat that showed |
| 700 ms | the pot's chips tick out and the winner's tick in, both figures snap, and the award line is wiped in under the board |

`readShowdown` in `best-five.ts` picks the five. The engine already knows them,
but it knows them through `phe`, whose lookup table is why the replay route is
lazy loaded: pulling that in would put roughly 80 kB gzipped back into the
bundle everyone loads to play, so the five are scored here over 21 combinations
with no table. **An uncontested pot reveals nothing and highlights nothing**,
because there is no winning five to point at when only one hand was ever live.
The mock has no uncontested pot, so that rule is pinned in the unit tests on
`readShowdown` (`../test/sizing.test.ts`) rather than in the e2e suite.

The award line is wiped in across `.award-zone`, a reserved row between the
board and the stats box. It is masked from its leading edge over 220 ms
(`--wipe` on `.award-chip` in `app.css` is how much is still covered) and it
is paint, not layout, so the zone's height holds the felt still. Reduced
motion draws it in place.

## When the match ends

`end` no longer replaces the table. The server holds the last hand like any
other, then sends the result; the client keeps the felt rendered, dims it to 70%
and slides `result-panel.tsx` in underneath. Losing a match used to swap the
felt for a summary page one frame after the final hand, so the hand that decided
it was never seen, which is exactly what the owner reported.
`../../e2e/showdown.spec.ts` samples your cards at four moments through a lost
showdown and again after the end message, and every frame has them face up. It
also marks one of them before the decision and finds the same element
afterwards: **your own cards are never turned over at a showdown**, because they
were never face down. Only somebody else's flip, and the flip is a remount keyed
on that, so the hero's cards are not even redrawn.

A match opened cold from its URL has no felt to keep and still renders
`match-summary.tsx`. Both share `HandsSection`, which is what "review hands"
scrolls to.

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

Two places use it, and that is the whole model of money on this felt: the pot's
stack in the middle of the board, and a small stack of every denomination
beside each player's own figure. **A stack ticks: chips leave and arrive one
per column per tick (60 ms, `TICK_MS`), nothing flies.** A bet is the seat's
stack ticking down and the pot's ticking up on the same clock, driven from
`seat.stack` and `view.pot`, which already includes the street's bets, so
collecting a street moves nothing. At the pay step the pot ticks to nothing and
the winner's stack ticks up. The figures beside the stacks snap, and never
roll while chips tick. The mini stack is off on a phone, where its width is a
name's.

## The v2 felt (cards and chips as SVG)

`look.ts` is a context, `v1` or `v2`; `Table` takes `look` and stamps
`data-look="v2"` on `.match`. **Every live table draws v2** (`../routes/match.tsx`
passes it); the mock defaults to v1 so the footprint and screenshot suites keep
measuring the felt they were written for, and takes `?v2=1`. The replay is bare
and stays v1. Once the suites move to v2, v1 and the context go.
`look-v2.css` holds every v2 rule (materials, the SVG cards, the chip symbol)
and `felt-v2.spec.ts` checks what is drawn; the geometry is v1's too and lives
in `../app.css`.

- **One sprite, four pips.** `deck-sprite.tsx` is rendered once per table and
  holds the four suit paths, the back's hatch pattern and the chip symbol. A
  card face is a `<text>` rank in the house face plus two `<use>`s of its pip;
  nothing is a font glyph, so a heart is the same heart on every phone. The
  pattern's colour is a custom property read at the sprite's root, which is
  why the card tokens are declared on `:root, [data-theme]` and not on the
  card.
- **Paper and ink are tokens.** Dark, the face is `--text-primary` and the ink
  `--surface-1`; light, the face is `--surface-2` and the ink `--text-primary`.
  Red pips take `--danger-fill`, the solid red, because `--danger-text` is a
  tint tuned for a dark ground and the face is paper. The four colour deck
  swaps `--pip-d` and `--pip-c` for the chart blue and green.
- **A card is two faces on one element** with `preserve-3d`; a showdown card
  mounts at `rotateY(180)` and turns to its face. A face down card shows its
  back at rest, so `[data-back] .pc-back` is not rotated.
- **Chips tick, they do not fly.** See Chips above. The chip symbol is a low
  three-quarter view whose rim is 0.14 of its width; a column steps by that,
  so `.chip-col` is `0.72 + (rows - 1) * 0.14` widths tall and the reserved
  slots per denomination are unchanged. Colours are set per denomination on
  the stack and read through the `<use>` as `--_body`, `--_rim`, `--_mark`.
  A chip that has just arrived is set down from three pixels up in the time
  one tick takes; a chip leaving simply is not there any more.
- **The reserved columns leave gaps** between present denominations (a pot of
  28 is a green chip, two empty slots, a white one). Packing them would move
  chips when a denomination appears, so they are not packed, and a stack of
  small change stands to the right of its slot's centre.
- **No card has an opacity.** The deal is a card arriving from the middle of
  the table on a transform, and a showdown flip is a rotation; neither fades.
  The inline opacity the old deal left on every card sat over the dim the
  showdown puts on the board cards that did not count, which is why the dim
  had not been seen working.

## The geometry

One component draws every table, and one geometry. `layout.ts` is pure and
unit tested:

- **Rotation.** `seatOrder` puts the viewer at the bottom and the rest in seat
  order after them. Watching (a spectator, or a replay) seat 0 takes the
  bottom, so the same match reads the same way round every time it is opened.
  Only a real `view.you` gets an action bar.
- **The board is one row across the top.** Five slots, always all five, centred
  on a `--board-h` row of its own above everything: the wings start under it
  and the pot sits between them where the board used to be. It was split round
  the pot, the flop on one side and the turn and river on the other, which read
  as two boards rather than one hand; the owner's word for that was no.
- **Two columns under it.** Opponents sit in two columns either side of the
  middle, going round the table from your left: k=1 is the bottom of the
  left column, the column is climbed, then the right column is descended back
  towards you. `columnSizes` puts the odd one on the left (heads-up: one
  opponent, top left; six-max: three and two) and a column is packed to its
  top, level with the middle. `placeOf(k, n)` is the whole rule and returns
  `null` for k=0, because the band is your seat. Each seat is placed by two
  custom idents from it (`--r` is `s1`, `s2` or `s3`; `--c` is `l` or `r`)
  against named grid lines in `../app.css`, so the two arrangements below only
  redefine the tracks.
- **Every track is fixed.** The board's row, then three seat rows of `--seat-h`
  whether or not there is a seat in them, and a middle that is the pot in a
  `--pot-w` box, the 24 px award line and the `--box-h` stats box, each a fixed
  height. The middle column carries its own width (`--mid-w`) because the board
  used to be its widest child and no longer stands in it. So the felt's
  footprint is settled before the first card, and a heads-up felt is the same
  height as a six-max one.
- **The bottom row is v1's and a spectator's.** `.pos[data-k="0"]` spans the
  columns under everything, drawn at the seat's usual size; `.match[data-band]`
  drops it and its track, because there the band is that seat.
- **Two arrangements, one markup.** Wide, the middle sits between the columns
  and the top seats are level with it. Below a 1060 px container the
  middle cannot fit between two seats that hold a name, so it goes across the
  top under the board and the columns start under both. Below 560 the seat shrinks to what half
  a phone can hold (above, "A reserved slot has to be paid for somewhere").
  Container queries rather than media queries, because the replay draws this
  felt in a column of its own.
- **The columns hug the middle.** A seat is `min(100%, --seat-w)` and the left
  column's seats are packed to their column's right edge, the right column's
  to their left, so the table gathers round the board rather than spreading to
  the felt's edges. `--felt-w` is 1120, declared on `.match` so the band and
  the header share the column; the header's actions end on the felt's right
  edge.
- **Dealing.** `dealOrder` is round robin from the seat left of the button, one
  card each then the second, which is the order the engine deals in; the seat
  passes it to `playing-card.tsx` as the stagger index. `dealFrom` says where
  a seat's cards start: a left seat's come in from its right, a right seat's
  from its left, yours from above.

`layoutMode` survives only because `../chat/chat.css` keys the chat panel's
placement on `.felt[data-mode]`; the felt itself no longer has two shapes.

### The seat

One card, one row, one edge. Left to right: the avatar, the two cards (backs,
or faces at a showdown), the identity block with the name and its badges
right-aligned (flag slot, name, button marker, bot badge) and the stack figure
under the name with its small chip stack beside it, then the **action square**
on the seat's right edge.

The square is `--seat-h` on a side and always rendered, empty as a quiet
outline, so a word arriving in it moves nothing. It shows what the player just
did, as a verb line and an amount line (`actionWords` in `labels.ts`: "Bets"
50, "Calls" 50, "Raises to" 150, "Checks", "Folds", "All in" 320), in one of
the three action colours declared at the top of `../app.css` (`--act-bet` for
bet, raise and all in; `--act-call` for check and call; `--act-fold`), the
`-text` variant on an 18% tint of the colour. **The verb sits on the square's
own vertical centre, not the centre of the two lines together**: `.act-w` and
`.act-v` are each positioned off `--act-w-h`, the verb's own line height, so
"Checks" and "Folds" (no amount) land exactly where "Calls 50" does, rather
than a check or a fold's word riding high over an invisible reserved amount
line nobody can see. `--act-w-h` is declared beside `.seat-act`'s own
`line-height` and moved with it at the narrow container query, the same
paired-property bargain the dock's countdown length makes with the protocol.
The label is `seat.last` as the view carries it: it persists for the street,
the view clears it when the next street deals, and a fold keeps it to the end
of the hand. While the seat is acting the square holds `TurnSeconds` instead
and `TurnBar` runs along its bottom edge; both come from `turn-clock.tsx`
unchanged, the bar is re-placed
in CSS. Folded seats dim as they always have. A showdown hand name is not on
the seat: the band's result line says it.

`SeatView.out` seats render dimmed to 45% with their place ("4th") where the
stack would be, and `SeatView.bot` gets a small mark beside the name.

### The stats box

`StatsBox` in `table.tsx`: a `dl` under the board, labels left in
`--text-secondary`, values right, tabular, one type size, every value a grid
cell. Hand ("9 of 25"), Street, Blinds ("1/2, level 1"), Next level (only on
a format with levels, which is settled before the first card), To call. On a
phone the same box is one row of pairs and the next-level pair is hidden.
The practice table's live stats stay in `.practice-strip` under the felt: the
hand name, the outs with their cards and the equity's provenance are more than
a box this size can hold, and a box that dropped them would be a worse strip.

### The hand header

Only actions: Copy link (the match URL, `${origin}/m/${view.m}`, through g's
`data-copy`), Verify (to the hand page, where the seed hash lives) and Chat.
The hand, the street and the blinds are in the stats box; the seed hash left
the header because it means nothing to a player, and the header keeps its
reserved height.

## Sound

`sounds.ts` is one hook driven by the same view everything else is drawn from.
Nothing here asks whether sound is on: the module returns immediately when it is
off, and a pack is only fetched once something plays. Every effect keys on the
hand and action sequence, which is what stops a re-render replaying the last
thing that happened. See `../sound/CLAUDE.md`.

## Keyboard

| Key | Where | Does |
| --- | --- | --- |
| `f` | your turn | fold |
| `c` | your turn | check, or call |
| `r` | your turn | focus the amount field, from anywhere (the band: open the typed size) |
| `1` to `6` | your turn | v1's dock: write that preset into the field. The band: load that box into the button, or on a phone open the sweep on it |
| Enter | your turn, wide band | send the size the button says, or show the clamp |

The legend under the dock is desktop only, and it says the same thing in every
state: a line that comes and goes is a line that moves the felt. `r` works while
typing (it is how you get back to the field); every other shortcut is blocked by
`isTextEntry` in `../ui/bits.tsx`, so typing 137 into the field does not fold the
hand. **Enter is blocked there too**, on the band: the field has its own Enter
and the two together ran the send twice on one press.

## Promotion candidates for g-system

Poker-specific pieces live here only because g has nothing close. If one stops
being poker-specific, build it in g-system, not here.

- **`playing-card.tsx`**: rank and suit on a surface, plus face-down and
  empty-slot states. The empty slot holds the board's width so nothing shifts as
  streets arrive. Red suits use `--danger-text` as the palette's red; the only
  other red on the table is the fold colour, and a hand going is the one thing
  that colour means here. **Promotion: no, this is poker.**
- **`turn-clock.tsx`**: a countdown driven by a server deadline rather than a
  local duration, so a reconnecting client lands on the right remaining time. It
  draws the depleting bar and the seconds; on the felt both live in the acting
  seat's action square, and on the band along its top edge. **Promotion: yes.** g ships
  `.g-progress` and `.g-meter` but nothing that counts down.
- **`seat.tsx`** and **`dock.tsx`**: poker furniture. The dock's "bounded number
  with presets, a typed field and a slider, all clamped to one range, in a box
  that never changes height" is the generic half; the poker words are not.
  **Promotion: partly.**
- **`best-five.ts`**: a five card evaluator that exists only to avoid pulling
  `phe` into the bundle everyone loads. **Promotion: no**, this is poker, and the
  engine is the real evaluator.
- **`chip-stack.tsx`**: denominated chips. **Promotion: no, this is poker**,
  though the fixed-slot idea behind it (a member that appears takes a place that
  was already there) is worth stealing anywhere a group can change size.

## Gotchas

- **No figure on the felt rolls.** NumberFlow is gone from the seat and the
  pot: a stack that rolled every time a blind was posted spent the deal
  painting two values at once, and a figure rolling while chips tick is two
  things moving. Figures are plain text, keyed on their value (see "One
  footprint"), and printed without grouping: `1,200` is five characters in a
  four character slot.
- **Chips do not fly, so nothing can be left in the air.** The flight layer
  and its timers went with the flights; a replay stepping backwards, which
  used to leak a flight a scrub, now simply ticks its stacks the other way.
- **Generated names are CamelCase** (RedTiger, StealthyCyclone), so a plain
  ellipsis cuts a word in half. `shortName` in `labels.ts` drops whole words
  instead and the seat keeps the full name in its title. Its limit is 16, not
  14: at 14 it was cutting "PoliteSaxophone" down to "Polite" on a felt with room
  for all of it, which is a truncation nobody asked for and no test could see,
  because the mock dealt in seven-letter lowercase names. The mock deals in the
  names people actually get now, and the ring test asserts that it does.
- An avatar is seeded from a user id, never a name: a name can be claimed and
  changed and the picture should not change with it. `avatarSeed` in
  `../net/adapt.ts` falls back to the name for a row written before the server
  sent ids.
- The engine's hand descriptions come from `phe` in Title Case ("One Pair"). They
  are lowercased at the display site to match the house voice, which is also why
  `readShowdown` lowercases the name it takes off an award.
- **The action square is always rendered**, empty or not, and its two lines
  are full-width boxes with a reserved height: a centred box sized to its
  word moved when the word did, and an empty amount line collapsed to nothing
  and moved the word above it.
- The felt's inner box is `.felt-in`; `--felt-w` caps it at 1120 px and
  centres it, except in `bare` mode (the replay), which fills the card it sits
  in.
- A six-max match carries no hand count (`format.hands` is null) and the stats
  box says "12" without "of". `blindsRow` in `labels.ts` adds the level and a
  next-level row whenever `format.levels` holds more than one; `blindText` is
  the same fact as one line, for the summary.
- **A stack of chips sized to `--chip` is drawn at three sizes**: 20 px in the
  pot (18 on v1), 14 on a phone, 10 beside a player's figure. The felt's own
  `--chip` is set in the phone container query, on `.felt` rather than
  `.match`, because a container query cannot style the container itself.
