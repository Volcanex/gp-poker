# table

The felt. `table.tsx` renders one `TableView` and everything here is a part of
it: `seat.tsx`, `playing-card.tsx`, `turn-clock.tsx`, `chip-stack.tsx` and
`dock.tsx` on a live table, `result-panel.tsx` under a finished one and
`match-summary.tsx` for a match opened cold from its URL. `sizing.ts`,
`preactions.ts`, `best-five.ts`, `chips.ts`, `labels.ts`, `layout.ts` and
`results.ts` are pure and unit tested from `../test/`. `sounds.ts` is the
table's side of `../sound/`.

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

- Text that changes must sit in a reserved slot. `.hand-head .n` and `.street`,
  `.seat-last`, `.stack-v` and `.pot` all carry a `min-width` or a `width` for
  that reason, and the phone gives `.seat-last` a fixed one because a phone seat
  has no spare width to lend a long label.
- Centred text that changes length moves. `.dock-status` is full width with
  `text-align: center` rather than a box that shrinks to its string.
- A marker that comes and goes moves everything after it. The button `D` is
  always rendered and hidden with `visibility`, and the flag beside a name is
  the same bargain in a different shape: `FlagSlot` (`../ui/flag.tsx`) draws
  either the picture or an empty box of exactly its size, so a seat with a
  country and a seat without measure the same. The hairline is drawn inside the
  box for that reason.
- **A reserved slot has to be paid for somewhere.** The name line had nothing
  spare when it gained one, and a truncated name is worse than a moved badge,
  so two things left it: the avatar leaves the ring's name line below a 900 px
  felt (which the phone ring already did with it), and the dealer button leaves
  the stack table's name line below 560 px. Both go to a seat corner, out of
  the flow, where they cost no width and still cannot shift anything by
  arriving. Widening the ring seat instead was tried and does not work: a wider
  seat reaches further in, and at that width the two upper seats meet the pot.
  `../../e2e/ergonomics.spec.ts` is what holds the names whole.
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

v2 replaces the dock with `hero-band.tsx` at every width: your own two cards
drawn large in one bottom corner, the controls in a column under the thumb in
the other, and on a screen wide enough, the key legend between them. **The
phone layout is the shape and the desktop one is it scaled up**, which is why
this is one component and one stylesheet rather than two; `hero-band.css` is
written wide first and the phone overrides it at the foot of the file. v1 never
sees any of it, and the rules are scoped to `.hero-band` and
`.match[data-band]` so it cannot.

| | Phone | Wide |
| --- | --- | --- |
| Band height (`--band-h`) | 236 px | 236 px |
| Card | 104 px | 104 px |
| Hand column | the fan's own width | the fan's own width |
| Action column | 176 px | the rest of the felt's column |
| Raise control | the sweep sizer | six sizes and Custom |
| Key legend | none, there is no keyboard | one line under the controls |

**The band's ground is the page's and its content is the felt's.** The ground
runs the full width, because a band that stopped where the felt does would be a
floating panel; `.hb-in` inside it is capped at `--felt-w` and centred, so the
cards start on the felt's left edge and the controls end on its right one.
`--felt-w` is declared on `.match` (as well as on `.felt`) for exactly this, and
`table.tsx` stamps `data-mode` on both. Before, the felt sat in a 680 px column
while the band spanned 1366: the hand was at x 16 and the controls ended at
1350, with the legend adrift in the middle.

**The band is your seat at every width, not only on a phone.** The felt drew
your cards, name, button marker, stack, last action, avatar, rating and clock,
and the band drew most of them again a hundred pixels below; the rule that hid
the felt's copy has left the phone media query for `look-v2.css`. The clock came
with the rest of the seat: `TurnBar` is out of the flow on the band's top
border, the width of the felt's column, and `TurnSeconds` has a reserved 34 px
slot at the end of the figures line. The avatar and the rating did **not** come
with it: the avatar is decorative and aria-hidden, and the rating is on the
profile the name links to, which is the same trade the ring seat already makes.

**Your stack is `table.tsx`'s reading, not the band's.** `HeroBand` takes it as
a prop because at hand end it is held at what it was until the pot has actually
moved, which is the same hold the felt puts on every seat's figure: a result
message arrives 700 ms before the chips get there, and a band reading the view
straight printed the number you won while the pot was still in the middle. Two
readings of when a hand is paid is two readings that drift, so there is one, in
the place the felt already reads it. It counts nothing up: the felt's winner
rolls with `NumberFlow` inside a reserved `.stack-v`, and the band's figure has
the last action sitting directly after it, so it takes a reserved `4ch` and
changes in one step instead.

**One left edge for the corner.** The cards, the name line, the stack and the
last action all start on the felt's left edge. The figures used to be set in by
the flag's reserved box so they lined up with the name's first letter, which put
three edges in a corner that needs one; the flag now stands on the shared edge
and the name reads as indented behind it.

**Six sizes, not a sweep, under a mouse.** The wide band's raise control is
`presetsFor`'s six as six equal segments plus a narrower Custom, and one press
sends. The number keys do what pressing their segment does, so on a wide band
`1` to `6` **send** rather than writing into a field; `r` opens Custom, which is
a g input in the segments' own box with Enter to send and Escape to close, and
it clamps into the field like the dock's rather than sending a number nobody
chose. The phone keeps the sweep, which is why `useMedia` in `../ui/bits.tsx`
exists: the two controls cannot both be rendered and hidden with CSS, because
they would both answer the same keyboard.

g-system ships no segmented control, so `.hb-sizes` is composed from `.btn`'s
own fill, border and radius with the inner edges collapsed. **It is a g-system
candidate and belongs there**, not here.

**A spectator's band is 148 px, not 236.** The height a band is is the height
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
band **is** your seat: `.match[data-band]` hides `.pos[data-k="0"] .seat` at
every width and keeps its `.seat-bet`, which is what a chip flies from.
`data-band` is stamped by `table.tsx` only when the band is on screen **and**
the viewer has a seat, because a spectator's bottom seat belongs to a player
and hiding it would leave a hole. A wide felt used to keep its seat on the
argument that there was room for both; there was, and the result was every fact
about you drawn twice on one screen.

The only shift this band has ever had was the last-action slot. It is empty for
most of a hand, an empty box has no baseline of its own, and the phone's row was
aligned on one, so the label jumped four pixels the moment a word arrived in it.
The row is aligned to its bottom edge instead.

**The legend leaves the table's grid on v2.** `KeyLegend` takes a class name and
the band renders it into a row of its own under the controls, so row 6 is empty
and the felt gets those pixels back. v1 keeps the row untouched. It used to
stand in the middle column, centred in the empty space between your hand and
your controls, which is the one place on this screen nothing should be asking to
be read. It is `--text-secondary` rather than the placeholder grey, because the
placeholder measures 3.68:1 on this ground and this is text a person reads.

**The table is one screen and never the page's scrollbar.** `.match` is capped
at `calc(100dvh - var(--top-h))` unless it is bare or ended, so a window too
short for the felt shortens the felt, which is the only `1fr` in the column and
scrolls its own overflow. Without the cap the column simply grew, because
`#root` is a `min-height`: measured on a 1366 by 768 laptop, a practice table
was a 903 px document in a 768 px window and the controls were under the fold.
The felt pays for the rest out of `look-v2.css`: the hero's seat leaves a whole
row in stack mode, and the felt's padding, its row gaps, the middle's padding
and the chip slots all come in one step. **The ring gives its share out of the
felt's padding rather than out of the ellipse**, and it never squashes: it is a
percentage geometry, so a `flex: none` keeps it whole and the felt scrolls
instead. Flattening it was tried and the cliff is sharp, at 392 px the two seats
either side of the top one overlap and at 394 they do not.

| At 1366 by 768, practice table | Before | After |
| --- | --- | --- |
| Document height, heads-up | 903 | 768 |
| Felt | 521 | 410 |
| Band | 260 | 236 |

**The mock's caption stands above the band, and the mock places it.** It printed
over the hero's cards, which are the one thing on this screen you have to be
able to read. It stays fixed and out of the flow, so it is still no part of the
footprint the tests measure, and `../routes/match.tsx` adds up `--band-h`,
`--band-watch-h` and `--strip-h` to lift it: only the mock knows which rows its
table has, and a `:root:has()` rule to work it out would be a whole document
selector running on every page in the app to place a caption on one.

**The band sits on the page's gutter, not its own.** `--band-gut` is 16px wide
and 12px on a phone, which is what the felt, the hand header and the dock this
replaces already use. It was 12 and 8, four pixels narrower than the felt above
it at both sizes, and the step in the edge was visible where the band's border
meets the felt. `--band-pad` is the vertical padding only, so changing the
gutter cannot move a row.

**Three lines, one edge.** The flag's reserved box sets the name in by
`--hb-flag` plus `--hb-flag-gap`, so `.hb-nums` is padded by the same, and the
name, the stack figure and the last action all start on one line. A stack flush
to the edge under a name that is not reads as a slip, and most players have no
flag, so the empty box is the common case rather than the odd one.

**The hand-over ghosts stand where the controls stood, as far as the result
line allows.** `--act-1/2/3` and `--act-gap` are the turn column's rows, and the
bottom ghost takes `--act-3` and the same gap, so the fold bar's box is drawn
exactly where the fold bar was: that is the control a thumb is resting on when
the hand ends. The two above it cannot also keep their heights. The result line
and its countdown want 43px at 1280 and 57px on a phone, and three ghosts at the
turn column's heights would leave 39 and 35, which clips the countdown. So
`--ghosts-h` is fixed at 156 and 144, the two upper ghosts share what is left,
and the middle one at least keeps its bottom edge.

**Fold is a slide.** Drag the handle 70% of the way across and the hand goes;
release earlier and it springs back; a tap nudges it 12 px and springs back, so
the gesture teaches itself rather than needing a caption. Pointer events with
`setPointerCapture`, because capture is what keeps a drag alive when the finger
leaves the track, and the handle is moved with a transform rather than an
offset: an offset is a layout change and this control is 48 px from the felt.
A keyboard press folds outright (`e.detail === 0` is the only way to tell one
from the click a slide leaves behind). Where folding is not legal the bar is
disabled, never dropped.

**The sizer is g's slider stood on end, plus a sweep.** The rail is 4 px with
the part below the thumb in the accent, exactly as `.g-slider` draws it lying
down; the thumb is a 22 px circle with the control border. What is bespoke is
only the gesture: pressing anywhere in the column jumps to that point and drags
on from there, so a size is one thumb movement, and the hit area is the whole
column and draws nothing. Min is at the bottom and all in at the top, the way a
stack reads. The `input type=range` under it is invisible and carries no pointer
events: it is there for a keyboard and a screen reader, and the hit area owns
the gesture. Only three marks are drawn, and one that lands within 8% of another
is dropped, because a pot sized raise is often all in and two labels three
pixels apart say less than one.

**The keys are the dock's keys**, not a second copy: `useTurnKeys` in
`dock.tsx` owns them and takes two callbacks, one for `r` and one for the number
keys. In the dock they focus the field and write into it; here they open the
sweep and move it. Enter sends, and lives in the sizer because it only means
anything while a size is open. The clamp and all-in semantics come from
`raiseAction` and `raiseLabel` in `sizing.ts`, which the dock's `submitRaise`
also calls.

**Waiting, the status line sits on the band's floor.** It shares the bottom
line with the hand's last action, which is a 16px slot resting on that floor;
the status was centred in a 28px row instead and read six pixels above it.
`.hb-wait .hb-status` is bottom aligned on a 16px line for that reason, and the
watching state is untouched, because there the line is the only thing in a box
built for a hand and belongs in the middle of it.

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
the fan tilts the other way, the sweep moves to the near edge and the arrow on
the fold handle turns round. **The fan also stacks the other way round**: a
card's rank is in its top left corner, so mirrored, the second card lands over
the first one's rank and a left handed player could not read the card they were
dealt first. The tilted card is lifted by its own width times
the sine of the tilt, because a card rotated about its bottom corner drops the
far one off the bottom of the band and onto the page.

## Sizing

**The typed field is the source of truth.** It holds a raise-to total, opens the
numeric keypad on a phone, and submits on Enter. A number outside the legal
range is clamped **into the field** and not sent: the next press sends the
clamped number, so a size nobody chose never reaches the server. The primary
button always prints the number it will send.

`presetsFor` gives six slots, always the same six in the same order, because the
number keys address them and a preset that moves is a preset nobody learns.
Postflop they are min, a third, a half, two thirds, pot and all in; preflop the
middle three become 2x, 2.5x and 3x the current bet, which is how people size a
raise before a flop. Duplicates are no longer collapsed the way they were when a
preset sent the action: a preset now only writes into the field.

The slider is secondary and desktop only, and it carries no `data-output` bubble
because the field beside it already prints the number. g still owns its fill
(see `../ui/CLAUDE.md`).

`TableView.pot` **includes the current street's bets**, which `presetsFor`
depends on: a pot-sized raise is `myBet + call + (pot + call)`. The unit test
pins it.

## Hand end

`table.tsx` runs a three-step sequence off the arrival of `result`, and every
step is in the felt, never in the layout:

| At | What happens |
| --- | --- |
| 0 ms | shown cards flip in place, 180 ms each, staggered 60 ms. The flip is a remount keyed on face up, which is what keeps it where the card already lies instead of dealing it again |
| 400 ms | the winning five are outlined and the rest of the board dims to 35%, hand names appear beside every seat that showed |
| 700 ms | the pot counts to zero, a chip lands in the award zone and the winner's stack counts up |

`readShowdown` in `best-five.ts` picks the five. The engine already knows them,
but it knows them through `phe`, whose lookup table is why the replay route is
lazy loaded: pulling that in would put roughly 80 kB gzipped back into the
bundle everyone loads to play, so the five are scored here over 21 combinations
with no table. **An uncontested pot reveals nothing and highlights nothing**,
because there is no winning five to point at when only one hand was ever live.
The mock has no uncontested pot, so that rule is pinned in the unit tests on
`readShowdown` (`../test/sizing.test.ts`) rather than in the e2e suite.

The award chip lands in `.award-zone`, a reserved row under the board. The old
flight targeted the pot badge and landed on top of the pot label.

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

Three places use it: the bet on the line to the pot (the stack is inside the
element that flies, so the chips travel rather than a badge standing in for
them), the pot, and a mini stack of the big three denominations beside a
player's own number. The mini stack is off on a phone and off on a ring, where
forty two pixels is a name.

## The v2 felt (cards and chips as SVG)

`look.ts` is a context, `v1` or `v2`; `Table` takes `look` and stamps
`data-look="v2"` on `.match`. **Every live table draws v2** (`../routes/match.tsx`
passes it); the mock defaults to v1 so the footprint and screenshot suites keep
measuring the felt they were written for, and takes `?v2=1`. The replay is bare
and stays v1. Once the suites move to v2, v1 and the context go.
`look-v2.css` holds every v2 rule and `felt-v2.spec.ts` holds it to the same
zero layout shift as v1.

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
- **Chips are drawn only where they move**: the bet and the pot. The mini
  stack beside a player's own number is hidden. The chip symbol is a low
  three-quarter view whose rim is 0.14 of its width; a column steps by that,
  so `.chip-col` is `0.72 + (rows - 1) * 0.14` widths tall and the reserved
  slots per denomination are unchanged. Colours are set per denomination on
  the stack and read through the `<use>` as `--_body`, `--_rim`, `--_mark`.
- **Chips travel, they do not dissolve.** A flight is one opaque stack in
  `.chip-flights`, a layer over `.felt-in` and out of its flow, placed by the
  middle of its bottom edge and moved on a transform: 380ms on the house
  ease-out, one stack a seat, 40ms apart, in the order a dealer collects them,
  from the seat left of the button round to it. Nothing in it has an opacity at
  either end. It replaced a `layoutId` shared between the seat's chip and the
  pot's, which crossfaded two elements while it interpolated the box between
  them and read as a dissolve, and as a blur with several seats in.
- **Both ends are measured off the DOM**, because the felt has three geometries
  (the heads-up stack, the ring, the phone's portrait grid) and only the browser
  knows which is in force. `chipAt` in `table.tsx` remembers where each seat's
  chips last stood: by the time a bet has been collected React has taken that
  element off the felt, so the two layout effects that start a flight are
  declared **before** the one that refreshes the cache, and read the felt as it
  was drawn a moment ago. A flight scales between the chip sizes at its two
  ends, which is how a 14px ring bet lands as part of a 24px pot.
- **The middle's stack is the money collected, not the pot.** The protocol's
  pot is the total *including* the bets still in front of players, and v2 draws
  those at their seats, so `.pot-chips` holds the pot less what is still on the
  line and a bet's stack landing is what makes it grow. It is held at its old
  value while the chips are in the air. The figure beside it is the protocol's
  total and so does not move when a street is collected: collecting adds no
  money. The stack carries no margin and stands on the slot's floor, because
  that floor is the point a flight is measured to; v1's 2px lift stood it short
  of where a flight landed.
- **The award lands and stays.** At settle the middle leaves for each winner in
  turn, and a winner's number ticks up when their stack arrives rather than
  when the result does (`paid` in `table.tsx`). The chips sit in front of them
  until the next hand deals; there is nothing to fade them out for. On a ring
  they land over the award line under the board, which is where a bottom seat's
  bet slot hangs. That line is masked in from its leading edge over 220ms
  rather than faded and dropped in from the pot: `--wipe` in `look-v2.css` is
  how much of the pill is still covered, and it is paint, so the zone's
  reserved height still holds the felt still and a split pot's two lines stay
  side by side in the flow. v1 keeps the drop and the fade it has. Reduced
  motion draws no flights at all: chips are at the
  destination and the numbers land with them. v1 keeps the shared-layout
  flights it had.
- **The reserved columns leave gaps** between present denominations (a pot of
  28 is a green chip, two empty slots, a white one). Packing them would move
  chips when a denomination appears; it could be done with a fixed-width
  container and a layout animation, which the observer would not count, but
  it has not been. The consequence, measured at 1280: a bet of 52 draws a green
  chip and a white one with an empty red slot between them, and the ink inside
  the five-column box sits 10px right of the lane's centre line, where a bet
  using every denomination sits 16px left of it. The bet's figure has no
  reserved width either, so the chips beside it slide about 4px when the amount
  gains or loses a digit.

## Two to six seats

One component draws every table. `layout.ts` is the whole geometry and it is
pure, so the rotation is unit tested rather than eyeballed:

- **Rotation.** `seatOrder` puts the viewer at the bottom and the rest in seat
  order after them, so the player on your left, the next to act, is the next one
  round to the left. Watching (a spectator, or a replay) seat 0 takes the
  bottom, so the same match reads the same way round every time it is opened.
  Only a real `view.you` gets an action bar.
- **Two shapes, one markup.** `layoutMode` is `stack` for two seats and `ring`
  for three to six. Stack is the three-row felt heads-up has always had; ring
  places seats on an ellipse. The difference is entirely CSS on
  `.felt[data-mode]`: a seat, a bet and a chip flight are the same elements
  either way, which is why the heads-up layout survives untouched.
- **Nothing overlaps, by construction.** In ring mode each seat owns a layer
  inset by half a seat box, so a seat at the far edge of the ellipse still sits
  inside the felt. The bet gets the same layer inset further by a whole seat
  box: the same ellipse shrunk by exactly the room a seat takes up, which is why
  a chip always lands between its seat and the pot and never under either. Both
  read the same `--x` and `--y`.
- **The felt sizes itself with container queries**, not media queries: the
  replay draws this table in a narrow column beside its action list, so the
  question is how wide the felt is, not how wide the window is. `.match` is the
  container.
- **Below 640px the ring gives up and the felt goes portrait.** Six seats across
  a 366 px felt leave 120 px each, which is not a seat: the ellipse was
  truncating every name and the avatar had been dropped to buy room. So the felt
  becomes four rows instead, the way a phone poker client has always done it.
  The players furthest round the table go along the top, your two neighbours
  under them either side, the board across the middle, and your own seat across
  the bottom at the size every other table draws it, because your two cards are
  the ones you have to read. `portraitSlot` says which cell each seat takes and
  is unit tested; the CSS under the container query is mostly undoing the
  ellipse's absolute positioning. Row 1 is empty at three and four seats, and an
  empty grid row is nought pixels, so four rows draw every table.
- **A bet hangs off its own seat on every ring**, above it or below it depending
  on which half of the felt the seat is in, and over its own outer half if the
  seat is down one side. It used to ride a second ellipse inset between the seats
  and the pot, which read beautifully and only worked while the seats were
  narrow: widening them so a name would fit left a band a few pixels across, and
  the chips ended up on the seats' own cards, on the board and on the pot figure.
  Anchored to a seat a chip cannot reach any of them, and the flight to the pot
  still carries it, because that is one element with one layout id rather than a
  position. The ring's chips are 10 px, not 18: a ring seat has 68 px between its
  inner edge and the board and the full size stack is wider than that on its own.
  `slotAt` returns the side and it is unit tested; `../../e2e/ergonomics.spec.ts`
  checks at three widths and four points in a hand that no chip touches the pot,
  the board, a seat or another chip.
- **Two things hang off the seat rather than sitting in it there**: the avatar on
  the top left and the dealer button on the bottom right. Out of the flow they
  cost no width, which is what buys the name back, and they still cannot shift
  anything by arriving. The button is on the bottom because the top right is
  where the name line ends: a bot badge and a dealer button were landing on each
  other there, which happens on any practice table, where the player on the
  button is a bot as often as not.
- **Dealing.** `dealOrder` is round robin from the seat left of the button, one
  card each then the second, which is the order the engine deals in; the seat
  passes it to `playing-card.tsx` as the stagger index. In ring mode each card
  also starts from the middle of the table, so cards fan outwards.

`SeatView.out` seats render dimmed to 45% with their place ("4th") where the
stack would be, and `SeatView.bot` gets a small mark beside the name.

**A ring seat is everything fighting for one width**: cards, an avatar, a name
with up to three badges, a stack, a hand name and a clock. **Generated names are
two CamelCase words and run to sixteen characters**, so the name wins and the
rest give way. The rating goes (it is a click away on the profile the name leads
to), the word "units" goes (every number on this felt is in units, and "all in"
still shows), the name's row spans the clock's column and the seconds move down
beside the last action, and on the narrowest ring the avatar leaves the flow for
the seat's corner.

The seat is 300 px wide above a 900 px felt and 268 below it, and **both numbers
are measured, not chosen**: they are the widest a seat can be before the two
lower seats reach in far enough to sit on the board, which the taller ring at
the narrower step then buys back. The ellipse gives up entirely below 740, for
the same reason: below that a seat that clears the pot is too narrow to hold a
name. `../../e2e/ergonomics.spec.ts` checks at 768, 1280 and 1920 that no name
is truncated, that no seat touches the board or the pot, and that no badge has
wrapped off the name's line.

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
| `r` | your turn | focus the amount field, from anywhere |
| `1` to `6` | your turn | write that preset into the field |
| Enter | the field | send the raise, or show the clamp |

The legend under the dock is desktop only, and it says the same thing in every
state: a line that comes and goes is a line that moves the felt. `r` works while
typing (it is how you get back to the field); every other shortcut is blocked by
`isTextEntry` in `../ui/bits.tsx`, so typing 137 into the field does not fold the
hand.

## Promotion candidates for g-system

Poker-specific pieces live here only because g has nothing close. If one stops
being poker-specific, build it in g-system, not here.

- **`playing-card.tsx`**: rank and suit on a surface, plus face-down and
  empty-slot states. The empty slot holds the board's width so nothing shifts as
  streets arrive. Red suits use `--danger-text` as the palette's red; nothing
  destructive in this app is red (Fold is `btn-tertiary`), so the meaning colour
  is not overloaded. **Promotion: no, this is poker.**
- **`turn-clock.tsx`**: a countdown driven by a server deadline rather than a
  local duration, so a reconnecting client lands on the right remaining time. It
  draws the depleting bar along the acting seat's top edge and the seconds
  beside its last action. It replaced a 20 px ring at the far corner of the
  seat, which the audit found people missed. **Promotion: yes.** g ships
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

- **A NumberFlow's digits live in a shadow root as a reel**, so reading one as
  text reads `0123456789`. Assert against something in plain markup instead. Its
  host is `display: inline-block`, which is why the pot's counter is given
  `display: block; width: 100%`: a counter that resizes itself is a counter that
  shifts everything beside it.
- **One stack animates, and it is the winner's.** Everywhere else the number
  snaps. A stack that rolls every time a blind is posted spends the deal painting
  two values at once, which is what a live table was caught doing two and a half
  seconds in, and the wireframe only ever asked for the count up as the pot
  lands.
- The stack is `useGrouping: false`. A grouped `1,200` is five characters in a
  four character slot, and it moved the word beside it.
- **A chip flight's removal timer must outlive the view that started it.** It
  used to be returned from the effect that armed it, so the next state cancelled
  it, and a state that moved no chips returned early and never armed another:
  the flight stayed on the table for good. Stepping a replay backwards leaked
  two a scrub until motion had a hundred of them sharing a handful of layout ids
  and was throwing the pile below the felt. The timers live in a ref and are
  cleared on unmount and nowhere else. A replay makes no flights at all now: it
  steps in both directions, and a chip cannot fly backwards out of a pot.
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
- **`.seat-last` is always rendered**, empty or not. It is a grid column of its
  own, so a label that comes and goes would otherwise shift the clock beside it.
- The felt's inner box is `.felt-in`, not `.ring`: `.ring` is the timer's svg.
- The felt caps its column at 680 px heads-up and 960 px on a ring, and centres
  it, except in `bare` mode (the replay), which fills the card it sits in.
- A six-max match carries no hand count (`format.hands` is null) and the header
  says "Hand 12" without "of". `blindText` in `labels.ts` adds the level and the
  countdown to the next one whenever `format.levels` holds more than one.
