# table

The felt. `table.tsx` renders one `TableView` and everything here is a part of
it: `seat.tsx`, `playing-card.tsx`, `turn-clock.tsx`, `chip-stack.tsx` and
`dock.tsx` on a live table, `result-panel.tsx` under a finished one and
`match-summary.tsx` for a match opened cold from its URL. `sizing.ts`,
`preactions.ts`, `best-five.ts`, `chips.ts`, `keys.ts`, `labels.ts`,
`layout.ts`, `sitout.ts`, `collect.ts` and
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
| 2 | `.hand-head` below 900px, or `.game-panel` when the hand info is a panel (see "Leaving a game" and "Where the hand's own information stands") |
| 3 | `.felt`, the only row that takes what is left |
| 4 | `.practice-strip`, the practice table's live stats, unless the band has taken them |
| 5 | `.dock` |
| 6 | `.dock-keys`, the key legend, desktop only |

Rows 1, 2 and 4 are optional and an empty grid row is nought pixels, so the
combinations are one template rather than several, and a strip can only take
room from the felt. All three are settled before the first card: who is
watching, whether a table is a practice table and whether the viewport is
wide enough for the site's own top bar to hold the header's actions cannot
change mid-hand, which is what makes them safe to put in this column at all.
The spectator's strip used to sit outside the grid on the argument that a
strip only some viewers see does not belong in it, which was true of a strip
that could arrive mid-hand.

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

## Leaving a game

`leave-control.tsx` is the button and the dialog behind it, drawn into
`.head-acts` beside Copy link and Verify. **`head-acts` is the only place on
this screen it can be**: it is the group that already holds the things that
are not the hand, and it is the one part of the table no decision is ever
taken from. A control that ends a match must not be a fat finger from a fold.

## Where the hand's own information stands

Two placements, and the player picks: **Hand info** under Settings > Table,
`data-table-info` on the root, the panel being the default and therefore the
absent attribute.

- **In a panel.** One card in row 2, top right under the account chip, holding
  the hand, the street and the blinds over the four `head-acts` controls.
- **In the seat.** The same three readings compacted onto one line in the
  empty right-wing seat cell, which is empty in both modes: six-max seats its
  hero in the band and heads-up has the whole column spare.

**The panel floats over the felt above 1060 and takes row 2 below it.** It
took the row at every width once, and a row here is a full-width band across
the top of the screen with one card in its right-hand corner: 129 px of the
page's own black, all of it out of the felt, which is the one row on this
screen that should have the height. The owner's word for it was that it
squishes the game.

What it floats over above 1060 is the felt's top right corner, and that corner
is empty: the board is one centred row across the top and the right wing's
first seat starts under it. Below 1060 the wings stop being wings (the felt's
own container query puts the middle across the top and stacks both columns
under it), there is no spare corner, and the panel goes back to a reserved
row, which cannot overlap what starts after it. One threshold, and it is the
one the felt already changes shape at.

The clearance is bought with the card's own width. At 340 the four controls
wrapped to two rows and the card stood 113 px tall, which reaches the first
seat at 1280x720 with huge seat cards; at 360 they are one row and it is 79,
which clears every combination of seat card size and window this file is
measured at. The numbers are in `../app.css` under "game panel", and the
matrix they were checked against is 1920x1080 down to 1024x700 at all three
seat card sizes.

**The chevron shuts it.** The two halves of the card are read at completely
different rates: the hand, the street and the blinds every hand, and Copy
link, Verify, Leave game and Chat once a match if at all. Shut, the facts stay
and the controls fold away under `gp-acts`, which is `hidden` rather than
unmounted so the leave dialog's wiring (below) survives it. It is a setting
(`gamePanel` in `../ui/prefs.ts`), not this component's state, because a
player who shuts it wants it shut next hand.

Row 2 still holds one thing at a time. `.hand-head` and `.game-panel` are
never both rendered, so below 1060 the row is theirs in turn and its height is
whichever one is in it, nought when neither is.

`head-acts` itself stands in one of two places, decided in `table.tsx` by
`TOP_BAR_ACTS` (`(min-width: 900px)`), never both: above it, portalled into
`.top-acts` in the site's own top bar (`../ui/shell.tsx`), which is where
`Table` has no row of its own to spend on it at all; below it, in `.hand-head`,
a row of this screen's own, because the top bar has no room left for it there
beside the account and settings menus the route already carries in it at
every width. One `<span className="head-acts">` is declared once in
`table.tsx` and moved wholesale, so the two homes cannot drift into two
different sets of controls.

It is rendered for a seated player and only ever *disabled* once the match is
over, never removed, so neither home's box moves: whether you have a seat is
settled before the first card, which is the same argument that lets the watch
bar be a row of the grid. A spectator gets no control at all.

A casual or practice table leaves on the press. A ranked one opens the g-system
dialog first and says two things: what leaving does to this match (forfeit,
rated as a loss) and what it does to the next one, which is `leaveWarning` in
`labels.ts` reading `walkoutBanMs` from the protocol. That is the same table
the server charges from, so the warning cannot promise a punishment that is
not the one applied. The dialog closes on Escape and on the backdrop, unlike
the ready check's, because nothing is running against the player while it is
open and dismissing it means the same as keeping playing.

Somebody already out of a multiway match leaves on the press even at a ranked
table: they have no stack left to forfeit and the server does not charge a
walkout for a seat that already has a place (`handleResign` in
`match/room.ts`), so a dialog warning them about a punishment that will not
land would be lying to them.

**`head-acts` has a width budget wherever it stands, and the leave control
spends most of it.** It may not wrap and may not scroll, so four controls plus
the chat toggle have to fit at 360 in `.hand-head`, and they do not while the
copy button carries its label: the row ran 23 px over, which pushed Chat off
the edge and left the group's position depending on how a font measured,
which is what made the 360 screenshots flake. Below 520 px the label is
hidden and the copy button is its icon (`../app.css`), which leaves 41 px of
slack at 360 and 71 at 390. Anything else added to this group has to be paid
for out of that, in whichever home it is currently standing in.

The `<dialog>` sits inside `.head-acts` with the button that opens it. A
closed dialog is `display: none` and an open one is in the top layer, so
neither is part of the row: `../../e2e/leave.spec.ts` asserts the table's boxes
and the layout-shift total are untouched by opening it.

**Backdrop dismiss is g-ui's, not this file's**, and it is wired by an effect
in `table.tsx` keyed on `headRef` actually pointing at a mounted node, walking
`head-acts` and finding every `dialog.dlg` under it. It is not `useGInit`'s
own once-on-mount pass: the portalled span mounts a render after `table.tsx`
does (it is waiting on the top bar's own slot to exist), and crossing 900
swaps the portalled span for the row's own or back, so `headRef` points at a
fresh, unwired node more than once in this component's life, which a
once-only effect cannot see. Move the dialog out of `head-acts` and clicking
the backdrop silently stops closing it, in either home.

What the press *does* is the route's (`../routes/CLAUDE.md`), because only the
page holding a subscription knows how to end a match.

## The dock

One region, one height (128 px desktop, 150 px phone), three states rendered in
the same box and cross-faded at 120 ms with `AnimatePresence mode="wait"`.
Nothing slides. A spectator gets a fourth, `watch` (see `../routes/CLAUDE.md`).

| State | What is in the box |
| --- | --- |
| `wait` | pre-action pills, and a status line saying who is being waited for |
| `turn` | the sizing presets, the amount field and slider, then fold / check or call / raise |
| `over` | the result line with a countdown, and the three choices as inert outlines that hold the height |

**An armed pre-action is pressed down and lit.** The state was in the markup
from the start (`aria-pressed`, `data-on`) and nothing was drawn for it but a
background two per cent lighter than its neighbours', so the one control on
this screen that stays on after you let go looked exactly like the two that
did not. Three things say it now: the tone of the action it will take, a full
weight border in that tone, and an inset shadow that puts the button's face
below its own edge. `preactions.ts` says which tone each wears, and the rule
there is that green is the one that puts chips in and red is the two that can
give the hand up. Pressing an armed pill disarms it, which is what the pressed
look is promising. No transition: the press is the movement.

**And the three stand in the three controls' own boxes.** Check or fold where
Fold is, call any where Call is, fold to any bet where the raise button is, at
both widths, so a pill and the button it becomes are the same shape in the
same place and the band does not re-divide when the turn arrives. They were
three equal thirds across the whole floor before, which put every one of them
in a box no control ever occupies. The tracks are written out in
`hero-band.css` rather than nested in an `.hb-acts` of their own, because the
phone stacks the same three flat children up one column and a wrapper would
have to be undone there; the phone reverses their order instead, so the pill
that folds you is the one on the bottom edge under the thumb.

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
| Band height (`--band-h`) | 265 px | 243 px at the default |
| Decision line (`--hb-line-h`) | 24 px | 24 px |
| Practice readings | the strip, in the table's row 4 | a section on the right, above 1100 px |
| Card | 100 px at the default | 100 px at the default |
| Hand column | the hand's own width | the hand's own width |
| Action column | 176 px | the rest of the felt's column |
| Sizes | six, two rows of three | six and a custom square, one row |
| Actions | three rows: bet, call, fold | two groups: fold and call, then bet |
| A size of your own | the sweep sizer | a typed field, key `r` |
| Key legend | none, there is no keyboard | one line under the controls, dismissable |
| Your own line | under your cards | under your cards, or one line over the controls |

### Where your own line stands

The flag, the name, the button marker, the stack, its rack and the last action
you took: `HeroMeta`, one component in two homes, and the player picks with
**Your line** under Settings > Table (`handMeta` in `../ui/prefs.ts`).

- **Under your cards**, the default: two rows on the cards' own left edge, the
  name over the figures, inside `.hb-hero`.
- **Over the controls**: a block of its own in `.hb-in` above the acts column,
  and the cards take their column whole. **Stacked, exactly as it is under the
  cards** (own request, twice filed): who on top, the stack, its chips and the
  last action under it, both left aligned in the same grid area rather than
  spread across it. It used to fold flat, who on the left with the width and
  the figures pinned to the far right of the same wide row over the controls,
  which read as a name at one edge and a stack a couple of hundred pixels from
  it at the other; only `.hb-meta`'s `grid-area` differs from the under-cards
  rule now; the row shape is the one shared rule (`hero-band.css`). Left
  handed it turns round with everything else, off the same general rule
  (`:root[data-hand="left"] .hb-who`/`.hb-meta`/`.hb-nums`) rather than a copy
  of its own. The controls' column pays `--hb-meta-h`, the full stacked pair,
  where it once paid one row: the band ends up close to the height it is under
  the cards rather than a few pixels off it.

The band is as tall as its taller column, so the line's height is a pair of
terms in `hero-band.css`, `--hb-meta-in-hand` and `--hb-meta-in-col`, and
moving the line is moving which of the two is nought. Written that way rather
than as two whole formulas per placement because the phone overrides one of
the sums and a second copy of it is a copy that drifts.

**Wide only.** `hero-band.tsx` keeps the line under the cards below 561 px
whatever the setting says: a phone's band is a hand beside a thumb's column
with no spare row in either, and the setting is about a row the wide band has
and the phone one does not.

**The band's ground is the page's and its content is the felt's.** The ground
runs the full width, because a band that stopped where the felt does would be a
floating panel; `.hb-line` and `.hb-in` inside it are capped at `--felt-w` and
centred, so the cards start on the felt's left edge and the controls end on its
right one. `--felt-w` is declared on `.match` for exactly this, and `table.tsx`
stamps `data-mode` on both.

**The line stands off the divider.** `--hb-line-top` is 4 px of padding at the
top of the band and it comes out of the gap under the line, so the two cancel,
the band is the height it would be without either, and `--band-chrome` does not
carry it. Flush against the band's own top border the words and the deal button
were touching it, which is what the owner reported: one pixel from a hairline
reads as nought. Since the line came down to 24 px the 22 px button is a pixel
taller than the 20 px the line has left inside its own padding, so it overhangs
into that 4 px and sits three pixels clear of the border. It is anchored out of
the flow, so the overhang costs no layout; it is why the padding may not go
below three.

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

**The seventh square is a door, not a size.** `0` and the square at the end of
the row open the same sizer `r` opens, through the same callback, so the field
focuses and clamps identically however it was asked for; it is deliberately not
a seventh preset, because a preset holds a number and this holds a way to one.
It is drawn only under a mouse, where there is a keyboard to legend and a field
to type in; the phone reaches its sweep through the Bet button. Under about
800 px the word gives way to an ellipsis and the button's `aria-label` is what
still says what it does. `keys.ts` is the pure decision behind all of this and
is unit tested from `../test/`: `r` survives a focused field because it is how
you get back to it, and **`0` does not**, because a nought while typing belongs
in the amount.

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

**A practice table's readings are a section of the band above 1100 px**, and
the section's last reading sits on the buttons' own floor: the column spans the
key legend's row too, so it is padded off the bottom by that row rather than
running under it. They were a bar of their own between the felt and the band,
and the owner's note was
that they should not be: they take a third column on the far side of the
controls, ruled off with a hairline, and the felt takes the strip's row back.
The left group gives up the width for them (`--acts-w` drops to 240), because
fold and call are two words and the six sizes are six numbers. `table.tsx`
decides the host and renders `LiveStats` once either way, because it drives the
analysis worker and two of it would cancel each other's requests; below the
breakpoint, and on v1, the strip is still the strip. See `../analysis/CLAUDE.md`
for what the column drops.

**Two groups under a mouse, one stack under a thumb.** Wide, the controls split
left and right: fold and check or call on the left in `--acts-w`, which is a
capped share (`min(312px, 34%)`) and not a fixed width, because a band 600 px
wide is still the wide band and a fixed left group left the sizes forty pixels
to divide between them; the six sizes and the custom square stand directly over
the button that sends one, on the right. That is a row shorter
than the two rows of five, which is where the band's 40 px came from: **the
card size sets the band's height**, not the controls, so the cards came down
with it and the felt took the difference back. Under a mouse that is still
true, which is why the card is a setting and the height is derived from it; on
a phone the controls are the taller of the two and the band is theirs. On a
phone the same pieces
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

**And it carries its own way out.** A caption for a keyboard is read once and
then never again, and a player who knows the keys was left looking at them for
the rest of the match with the way to stop three clicks down a settings menu.
The `x` at its far end is that setting (`keyLegend` in `../ui/prefs.ts`),
pressed where the thing it governs is; Settings > Table puts it back, which is
why it is a switch there and not only a dismissal here. The captions are
`aria-hidden` and the button is not, so the one thing a reader is offered is
the one thing that can be pressed. Dismissing it does move the row it stands
in, which is the one thing the footprint rule forbids the table doing on its
own, and a player pressing a button is not the table doing it on its own.

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

The band has since taken 19 of those 40 back for the cards, which had become
too small to read: at the default it is 243 and the felt row 437, and the two
numbers move together with the card size setting (see the table above).
Neither shape scrolls at any of the three sizes.

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

**The hand's box is the hand's real bounds**, not the pair's. A card rotated
about its bottom left corner reaches up past the top of the pair by its width
times the sine of the tilt and out past their right edge by its height times the
same, so a box drawn to the cards' own size was eleven pixels shorter and
sixteen narrower than the thing inside it, and the tilted card crossed the
band's top edge and the column beside it. `--fan-sin` is written out for that
reason. The cards rest on the floor of the box and the slack is at the top,
which is where the tilt goes.

## Three layouts, three sizes, one calculation

**The hand is a setting** (`cards` and `cardSize` in `../ui/prefs.ts`, stamped
as `data-cards` and `data-card-size` on the root by `applyPrefs` and by the
pre-paint script in `../../index.html`). Both are pure geometry and the
geometry is all in `hero-band.css`; prefs knows the ids and the labels and not
a pixel.

| Layout | What it is | `--card-peek` | `--card-span` | `--card-rise` |
| --- | --- | --- | --- | --- |
| `stacked` (the default) | one card read whole with the other behind it, out far enough to read its index | 0.38 | 1.38 | 1.4 |
| `side` | two whole cards with a hair of daylight between them | 1.06 | 2.06 | 1.4 |
| `ajar` | the fan this replaced: the second card overlapped and tilted 6 degrees | 0.6 | 1.7463 | 1.5045 |

`--card-peek` is where the second card sits, in card widths; `--card-span` and
`--card-rise` are how wide and how tall the pair is, in the same unit, and the
box is drawn from them. 0.38 is measured rather than chosen: the index is drawn
from x=9 to x=34 of a hundred wide card (`playing-card.tsx`), so 0.38 clears it
with the card's own edge to spare.

**The card size is one number and the band's height is derived from it.**
`--card-want` is 80, 100 or 120 px, each a whole number of card heights
(1.4 times the width: 112, 140, 168) and each on the four pixel grid, and
`--band-h` is `--band-chrome` plus whichever of the hand and the controls needs
more room. Two hand-written heights sat at the root before and drifted from the
cards inside them: the phone's controls were five pixels taller than the box
holding them and had been for a while. Large is the default because the band
the board's row shrank took the cards to 76 and the owner could no longer read
them at a glance; the four pixels the decision line gave up (28 to 24) are the
sentence's own 20 px of text plus the bar, with nothing else in the row.

| At 1366 by 768 | Card | Band | Felt row |
| --- | --- | --- | --- |
| Regular | 80 by 112 | 215 | 465 |
| Large, the default | 100 by 140 | 243 | 437 |
| Huge | 120 by 168 | 271 | 409 |
| Large, ajar | 100 by 140 | 253 | 427 |

**The card gives way to the controls, never the other way round.**
`--hero-card` is `min(--card-want, (100vw - <chrome>) / --card-span)`, so a
layout that is wider per card takes a smaller card rather than reaching over the
raise button. That is what the old "below 380 the fan crosses it by thirteen
pixels" rule was for, and the clamp replaces it at every width and for all three
layouts: side by side at 390 comes out at 88 rather than 100, and everything
above a laptop width is the setting's own number.

**Two overlapping cards are the same paper, so the seam has to be drawn.** The
card's own hairline is `--border`, an alpha grey that over a near white face
comes out four values off it: measured, the join was invisible and the pair read
as one wide card with two ranks printed on it. The card in front casts the
band's own ground behind its leading edge, two pixels of a colour already on
screen rather than a shadow. It goes on whichever card is in front, which is
the second one right handed and the first one mirrored, and the leading edge is
the left one either way. Side by side needs none, because the gap is the
layout.

A setting changes the band's height, which the footprint rule allows and the
suites do not have to be told about: it happens when a player chooses it, not
between two states of the same table. `../../e2e/hero-band.spec.ts` pictures
every layout and every size on the mock at both widths, asserts the card is the
size the setting names, and asserts the hand ends before the controls start in
all three layouts at both widths, **and again on a practice table at 1100**,
where the readings' own section takes a third of the band and the clamp is the
only thing keeping the widest hand off the controls.

**Handedness is a setting** (`hand` in `../ui/prefs.ts`), stamped as
`data-hand="left"` on the root by the pre-paint script in `../../index.html` as
well as by `applyPrefs`, so a left handed player never sees the right handed
layout flash past. The band mirrors by swapping its grid areas at both sizes,
the second card sits along the other edge, the fan tilts the other way and the
sweep moves to the near edge. **The hand also stacks the other way round**: a
card's rank is in its top left corner, so mirrored, the second card lands over
the first one's rank and a left handed player could not read the card they were
dealt first. The tilted card is lifted by its own width times the sine of the
tilt, because a card rotated about its bottom corner drops the far one off the
bottom of the band and onto the page.

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

## The all-in run-out

When everybody left in the hand is all in there is nothing to decide, and the
server turns the live hands over and then deals the rest of the board a street
at a time behind a count of three (`server/src/match/CLAUDE.md`). Two things
on the felt answer it, and neither is new furniture.

**The count stands in the award zone.** `view.runout` is `{next, in}`, sent by
the server between the streets and absent on the beat one lands, and the zone
already reserves its height for the award line, which a hand still being dealt
has nothing to put in it. It is drawn as a plain badge, `Turn in 3`, keyed on
the value so a new number is a new node rather than a text node moving inside
a centred box, which is the same bargain the pot's figure and every stats
value make. Nothing else on the screen changes size, and the run-out is not in
the footprint suite's list for that reason: it is content arriving in a box
that was always there.

**The flip is keyed on the cards, not on the result.** `reveal` used to be
`result.shown` and nothing else, so a run-out, which has no result yet, would
have swapped a card back for a face with no turn at all. `faceUp` in
`labels.ts` is the one reading of "these cards are being shown", and the felt
takes a seat's own cards as its reveal while a run-out is running. A seat that
folded keeps its two question marks and reads false, so it stays face down;
your own cards were never face down and are not turned over, exactly as at a
showdown. When the result finally arrives it names the same two cards, so the
`up`/`down` key does not change and nothing flips twice.

**The decision line says what it always said.** `actingText` already reads
"Waiting for the next card" when nobody is acting, which is what a run-out is,
so the band prints one status and the felt counts. The `?runout=1` mock script
is the whole sequence with no server (`../dev/mock.ts`); it is its own script
rather than steps spliced into the heads-up one, because every spec that
freezes a step addresses it by number.

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

A match somebody left says so, in the panel's reason line and in the summary's:
`leaverOf` in `results.ts` derives who it was rather than reading a field off
the wire. The server places a leaver last among the seats that still had chips,
so the answer is the worst-placed row that finished with a stack, and a `who
left` field would be a second answer to a question `places` and `finalStacks`
between them already answer once.

## Chips

`chips.ts` is `denominate(amount)`, greedy over 500, 100, 25, 5 and 1, which is
how a dealer makes change: 137 is a hundred, a twenty five, two fives and two
ones. Greedy over those five also bounds a column, because four ones roll into a
five and three twenty fives into a hundred. A unit test walks every amount a
table can hold and pins it, which is what lets the felt reserve five chips of
height instead of the ten a stack will draw before it starts counting.

**The pot's rack closes up and stands under its figure.** The denominations it
is holding are packed side by side and the group is centred, so a pot of 3 is
one white chip under the number rather than one marooned in the last of five
reserved slots, 44 px right of it. `packOffsets` gives each column its distance
in columns and `.chips-packed` draws it **as a transform**, which is the whole
trick: the layout-shift observer does not count a box that is transformed, so
every column keeps the box it was dealt and only the paint moves. The rack
re-lays on the one event that already moves chips, the pot changing, so there
is still one thing moving at a time. The pot asks for this and nothing else
does, because it is the one stack with a figure under it rather than beside it.
Its figure is a step up the type scale from the rest of the felt's, at 18 px, in
the same fixed box, and **the figure's box is what the footprint tests
measure**: the chips are paint, the number is the thing that must hold still.

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

### The pot collects, then the street deals

**A street the betting put chips into waits 400 ms for them before its cards
come out.** `collect.ts` is the rule and `useDealt` in `table.tsx` is the beat;
`COLLECT_MS` is the number.

It exists because the wire gives the felt no beat of its own. The engine deals
the next street inside the action that closes the betting (`afterAction` in
`@opentable/engine`), and the runner broadcasts once per action, so **one view
carries both the caller's chips and the flop**: the pot's rack was still
ticking up while the cards landed over it, and two things were moving at once
on the one screen whose rule is that one thing moves at a time. Tickets
g7hfddbc and d62s9bgx are that, reported two days apart. Observed on a live
table before it was changed, every street: `pot 9 -> 14, board 0 -> 3, one
frame`.

**The beat is the felt's and cannot be the wire's.** Holding the board back on
the server would hold it back from the bots too, which decide off the same
view, and from the clocks that are already running on it. So the table is told
everything at once, as it always was, and the felt draws it in the order the
eye needs — exactly the bargain "Hand end" above makes with `result`.

- **Nothing waits for a street nobody bet on.** A flop checked through moves no
  chips, so the turn deals at once: a beat in which nothing moves is a beat.
- **The hand end and a paced run-out are left alone.** Both deal a board with
  the betting already over, and each owns its own sequence.
- **Anything else landing ends it early.** A quick bot's floor is 100 ms
  (`server/src/bots/pacing.ts`), so the next action can arrive inside the hold,
  and a seat may not be shown acting on a street whose cards are not on the
  table.
- **`onTable` is the only reading of the board while it runs**, and every
  consumer takes it: the five slots, the practice readings (`LiveStats` naming
  the flop's hand before the flop is drawn would be telling the player the
  card), and `sounds.ts`, which takes it as a second argument so the card's
  noise lands with the card rather than a beat ahead of it.
- **The replay and reduced motion snap.** A scrubber dragging through frames
  has no use for a beat between two of them.

The rule is enforced, not remembered: `../../e2e/collect.spec.ts` samples the
felt every 25 ms through that script and asserts the flop and the turn each
land a beat after the chips they arrived with. It watches the clock rather
than taking a picture, because what is under test is an order of events and
not a box.

`/m/mock?collect=1` is the script, its own for the reason the run-out's is its
own: the ordinary heads-up script splits the call and the flop over two steps,
which is the felt everybody wanted rather than the one the server sends, so it
could never have caught this. It deals two streets off a bet and its last one
off a check-through, so both halves of the rule are in one script.

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
- **The columns hug the middle, and the middle is the board's own width.** A
  seat is `min(100%, --seat-w)` and the left column's seats are packed to
  their column's right edge, the right column's to their left, so the table
  gathers round the board rather than spreading to the felt's edges. That
  makes a middle narrower than the board a middle the seats stand inside: at
  160 they overhung the community cards by 20 px a side and read as
  encroaching on the pot. `--mid-w` is the board's five cards and their four
  gaps less the two gutters beside it, which is exactly what puts a seat's
  inner edge on the board's outer one, at every board card size.
- **The felt's width is derived from the seat, and the seat from its cards.**
  `--seat-w` is `--seat-body` plus its two cards and `--felt-w` is two seats,
  the middle and the two gutters, so Other seats is one setting rather than a
  card size and a width kept in step by hand: 406 and 1044 at the default
  28 px card, and at huge the felt grows by exactly what the bigger cards
  take rather than the cards growing into room the name was using. `--seat-card`, `--board-card` and the widths
  derived from them are declared on `.match` and not on `.felt` for that
  reason: `.match` cannot read a variable declared on its own child. The
  phone's container queries still override the two card sizes on `.felt`,
  which is where they want them, because `--felt-w` is a max-width no phone
  reaches and `--mid-w` is not used below 1060 at all.
- **The card is what the seat is built round, but 60 is where it starts.**
  `--seat-h` is `max(60px, --seat-card * 1.4 + 18px)`, so only a card big
  enough to need more than the identity block takes more. Derived without the
  floor and off a 46 px default card, the seat stood 80 px tall holding 34 of
  content and the owner's word for it was that it looks like shit: a face
  down back carries no information at any size, so the Other seats setting is
  a reading preference (22, 28, 36) and not a scale the felt hangs from.
- **The identity block reads back from the action square.** Both its rows are
  right aligned against it, because the square is the one fixed thing on that
  end of the row. The name's line is the flag slot, the name, the rating and
  the badges; under it the stack's figure with the rack it is worth beside it,
  on one line. A rack and a number are one reading, and a row of its own for
  the chips split a number from the chips that are worth it and cost the seat
  a third of its height for nothing. The rack stands in the room the figure's
  reserved digits leave (`margin-right: calc(5ch + 6px)`), so it does not
  slide every time a stack gains or loses one.
- **Only `.seat-name` may shrink in `.seat-line`.** It alone carries
  `min-width: 0` and an ellipsis; the flag, the rating and both badges (`Bot`,
  `You`) all carry `flex: none`. They did not always: `.seat-bot` and
  `.seat-you` had no shrink protection, so under real width pressure (a
  six-max seat two to a row below 1060, a long name) flex's default shrink
  gave them a sliver of box while their text kept its full size and painted
  straight over the name beside them. "Shit is overlapping" was this.
- **A seat is also its own container, and both containers are named.**
  `.match` is `felt` and `.pos` is `seat`, in `../app.css`. **Every
  `@container` on this screen has to say which**, because a seat sits inside
  both and an unnamed query resolves against the nearer one: the day `.pos`
  became a container, the felt-wide phone tier at 560 started firing on every
  desktop seat, which is a 476 px panel wearing the layout half a phone gets.
  The picture, the rack, the flag slot and the rating all vanished from a
  desktop felt and the figure went to the bottom right corner of a box with
  nothing else in it. Nothing in the CSS was wrong on its own; the query just
  asked the wrong box how wide it was.
- **The `seat` container drops the rating below 390px.** A seat gets its own
  full column (406 at the default card, never below 398 while the wings are
  wings), so under 390 it really is in the two-to-a-row arrangement with
  something else beside it: 360 at 768, 179 on half a phone. There the rating
  is worth more to the name than to itself, which is the same order the
  felt-wide rule drops things in; the `Bot` badge follows it below 200. A name
  disappeared behind its own rating (`min-width: 0` shrinking it to nothing,
  not just tight) before this tier existed, at widths nowhere near 560.
- **The board's own track carries `--board-clear` past `--board-h`** (own
  request, 20px): `align-items: start` on `.felt-in` sits the board at the
  top of the taller track it now has, so the extra height lands between the
  board and `s1` rather than stretching the board itself.
- **Dealing.** `dealOrder` is round robin from the seat left of the button, one
  card each then the second, which is the order the engine deals in; the seat
  passes it to `playing-card.tsx` as the stagger index. `dealFrom` says where
  a seat's cards start: a left seat's come in from its right, a right seat's
  from its left, yours from above.

`layoutMode` survives only because `../chat/chat.css` keys the chat panel's
placement on `.felt[data-mode]`; the felt itself no longer has two shapes.

### The phone felt as rows

One exception to "one geometry", and it is the case the owner met first: a
seated player on a phone. `table.tsx` stamps `data-rows` on `.felt` for a
seated player under 560 (`PHONE`) at a two seat table always, and at a bigger
one when the Other seats setting says detailed (`data-seat-detail` on the
root, `../ui/prefs.ts`); the geometry is in `../app.css` inside the felt's
560 px container query. The geometry above reserves three seat rows in two
columns, so on a 390 px screen the one opponent stood in a half-width card at
the top of an empty left column with the board over it and two thirds of the
felt bare green; his words for it were a bad version of the desktop. With
`data-rows` the felt is read top to bottom the way the table is sat: each
opponent a full-width strip at the desktop seat's size (picture, cards, name
at 13 px, the rack beside a 20 px figure, the marker back in the flow; not
the rating, which cost the name its last three letters), the board, the pot
and one quiet line of readings with no box round it. Heads-up puts the one
opponent at the top and centres the board group in the room left, the slack
split by two `1fr` rows; a bigger table (`p1` to `p5`, from your left round
to your right) lists its five under the board group at 52 px on 26 px cards
with 44 px board cards, because five strips and the board in 531 px is a
tighter fit than one, and takes what is left at the bottom. Every other track
is fixed and the slack rows divide what a given screen leaves over, so the
footprint rule holds. `.felt-in` takes `flex: 1 0 auto` so those rows have a
height to divide.

**A short screen shrinks the rows now, rather than scrolling past them.**
"You have to scroll to see them" was the owner's own complaint about exactly
this: the slack rows going to nought was the documented ceiling and six-max
(five strips) sailed past it at anything under about 720px tall, which is not
a rare phone. `@media (max-height: ...)` tiers layered under the felt's own
560px container query (760, 640 and 570px, `data-mode="ring"` only; heads-up's
one `data-mode="stack"` tier at 700px predates this and still only trims the
board) step `--seat-h`, `--seat-card`, `--board-card` and `--chip` down in
three stages, tight enough that a table down to about 560px tall still fits
inside `.felt`'s own `clientHeight` with no internal scroll; the ring
template also gained a second `minmax(0, 1fr)` gap row, before the board as
well as after the last seat, so what slack is left splits rather than
collecting in one strip between the last opponent and the hero's own row.
Below the compact (non-`data-rows`) geometry has its own equivalent for a
six-max table not in the detailed reading, or a spectator's: `--seat-h`,
`--seat-card`, `--board-card` and `--chip` step up under `@media
(min-height: 690px)`, spending a tall phone's own slack on bigger cards
instead of leaving it as dead green above the board and below the last seat,
which was the same complaint's other half.

A spectator's felt keeps the geometry above, because the bottom seat is a
player's and still has to be placed. The ended match keeps the shape: the band leaves with the match, and
without this the felt under the result panel fell back to the half-width
opponent in an empty column; ended, the slack rows are nought and your own
seat, drawn again once the band is gone, takes a last full-width row, so the
finished table reads opponents, board, you. The chat button moves to the top
right corner for the listed table, the one corner that layout leaves clear.

**The compact seat is three columns.** The seat on half a phone (`normal`,
the default) is cards, the identity block and a 36 px action square; the
figure, which has a column of its own on the desktop seat, stands out of the
flow in the block's bottom right corner, because with its column the name
was down to five letters. Before this the square was the fourth child of a
three column grid and wrapped under the cards, where the seat's own overflow
cut the word in half, which is what "Folds" under every seat was. The Other
seats row in settings is that choice on a phone (normal or detailed) and the
card size everywhere else: a size has no purchase where the felt sets it.

**A phone table has no header row at all.** Under 560 the match's actions go
into a "Game" menu (g's `.menu` on the Popover API, `GameMenu` in `table.tsx`)
portalled into `.top-game`, the slot `../ui/shell.tsx` renders at the end of
the site's top bar in place of the settings button, which moves into the
hamburger's sheet for the length of the match. The same `head-acts` span as
every other home, stood up as a column of rows by `../app.css`; the copy
button gets its label back, the chat toggle leaves for a button on the felt
(`../chat/CLAUDE.md`), and the leave control's dialog opens from inside the
popover into the top layer above it. Row 2 of the grid is then empty and the
felt has those 44 px.

**A live table locks the page.** `table.tsx` stamps `data-table` on the root
for as long as a live, non-bare table is on screen and `../app.css` turns the
document's scrolling off under it: a page exactly one screen tall still
rubber-bands on a phone and drags the browser's toolbar away to show bare
ground under the band. The felt scrolls its own overflow as it always has,
and a finished match is a document again. The same block turns text
selection off on a live table (`user-select: none`, and the long-press
callout with it), because a thumb resting on the felt was lighting up names;
chat and the typed field keep theirs.

**The game panel is not drawn on a phone.** `PHONE` in `table.tsx` (the same
560) turns `panelMode` off whatever the setting says: a 340 px card over a
390 px felt was a row nearly as tall as the felt, and the setting is about
where a panel goes on a screen with room for one. So a phone is always `seat`
mode: the actions in `.hand-head`, the readings in the felt, which on the
heads-up felt is one quiet line under the pot with no box round it.

**The stats box's narrow rules follow its wide ones in `../app.css`, and
must.** They stood inside the 1060 container query with the rest of the
geometry, above the box's own rule, so every declaration the two shared
(height, width, display, padding) went to the rule later in the file, and
below 1060 in `seat` mode the box stood a seat's size in a seat row nobody
had reserved for it. The placement alone now stands with the middle's, so the
query can re-place it; the rest of the narrow rules stand in a query of their
own directly after the box's rule.

### The seat

One card, one row, one edge. Left to right: the avatar, the two cards (backs,
or faces at a showdown), the identity block with the name and its badges
right-aligned (flag slot, name, rating, button marker, bot badge) and the
stack figure under the name with its small chip stack beside it, then the
**action square** on the seat's right edge.

`seat.rating` sits beside the name, muted, the same figure the profile and
`PlayerBar` show, unrounded on the wire and rounded once at the display site
by `int()`. It is the first thing a seat gives up when it is short of room,
at 390px of its own container and again on the felt-wide rule under 560: half
a phone is 179px and a name is what a seat is read by there, so `.seat-rating`
joins the flag slot off `.seat-line`'s reserved space. It arrived on that line
after `--seat-body` was set, and the 34px it costs was added there rather than
taken out of the name.

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

The phone rule that stands the button marker in the seat's corner is scoped
to `.seat .btn-marker`: the band draws a marker on its own name line too, and
an unscoped absolute rule stood that one in the top left corner of `.match`.

### The stats box

`StatsBox` in `table.tsx`: a `dl` under the board, labels left in
`--text-secondary`, values right, tabular, one type size, every value a grid
cell. Hand ("9", or "9 of 25" on a stored match that had a cap), Street,
Blinds ("1/2, level 1"), Next level (only on
a format with levels, which is settled before the first card), To call. On a
phone the same box is one row of pairs and the next-level pair is hidden.
The practice table's live stats stay in `.practice-strip` under the felt: the
hand name, the outs with their cards and the equity's provenance are more than
a box this size can hold, and a box that dropped them would be a worse strip.

### The hand header

Only actions: Copy link (the match URL, `${origin}/m/${view.m}`, through g's
`data-copy`), Verify (to the hand page, where the seed hash lives), Leave
game and Chat. The hand, the street and the blinds are in the stats box; the
seed hash left the header because it means nothing to a player.

Above 900px this is not a row of the table at all: see "Leaving a game" for
where `head-acts` actually stands and why the row below it is optional
rather than reserved.

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
| `0` | your turn, wide band | open a size of your own, the same door `r` opens. Blocked while typing, where it is a nought |
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
- The felt's inner box is `.felt-in`; `--felt-w` caps it and centres it,
  except in `bare` mode (the replay), which fills the card it sits in. The cap
  follows the Other seats setting (above): 1020 at regular, 1044 at large,
  1076 at huge.
- A six-max match carries no hand count (`format.hands` is null) and the stats
  box says "12" without "of". `blindsRow` in `labels.ts` adds the level and a
  next-level row whenever `format.levels` holds more than one; `blindText` is
  the same fact as one line, for the summary.
- **A stack of chips sized to `--chip` is drawn at three sizes**: 20 px in the
  pot (18 on v1), 14 on a phone, 10 beside a player's figure. The felt's own
  `--chip` is set in the phone container query, on `.felt` rather than
  `.match`, because a container query cannot style the container itself.
