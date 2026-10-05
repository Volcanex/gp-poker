# solitaire

Client-only classic Klondike at `/solitaire`. `klondike.ts` owns the pure deal,
move rules, stock, foundation-first automatic moves, completion and undo.
`solitaire.tsx` renders the board with the table's `PlayingCard` and `DeckSprite`,
using `LookContext` v2. `solitaire.css` gives those same SVGs their board geometry
and material rules using the shared card tokens; the table's rules are scoped
under `.match` and cannot style a separate game.

Draw one is the default; draw three changes the next draw, and redeals are
unlimited. A move includes turning over the newly exposed tableau card. Complete
game is offered once every tableau card is face up and finishes the remaining
cards, including the stock and waste, in rank order as one undoable action.

Every one of the 52 cards is always in the DOM (stock and waste included), each
tagged `data-card` and `data-face`, so any change of state is shown as cards
moving rather than appearing. `commit()` is the one path into `play()`: it
measures every card's box, renders the new board, and a layout effect declared
after the screen-fit effect plays the difference with `motion.ts` (FLIP on the
Web Animations API, transforms only, about 200 ms ease-out). A run moves with a
small stagger, a card that changes side turns over in 3D on its inner
`.sol-face` span, a new deal flies out of the stock card by card and Complete
game sends the cards up one by one. Glides and drags use `transform`, the
lift at pickup uses `scale` and the hover lift and refusal shake use
`translate`, so none of them fight. Nothing fades. Under
`prefers-reduced-motion` every move is instant and only the sounds remain.

Pointer capture handles both mouse and touch dragging, past a 6 px threshold so
a tap stays a tap. Drag runs straight on the DOM: held cards follow the pointer
by inline transform, legal piles are marked through `data-drop-state` and the
target is the legal pile the held card overlaps most. A drop anywhere else
springs back. A refused tap shakes the run. Sounds go through `../sound`
(`sol*` events) and are timed to when the card lands. The win waits for the
last card, then `cascade.ts` throws the foundations off the screen on one
canvas, the classic bouncing trail, before the Play again panel. A short click delay lets
a double click or double tap request the foundation before a single tap chooses
another pile. Single taps prefer foundations, then legal tableau piles with
hidden cards; moving an entire king pile to another empty pile is not an automatic
move. Cards can always be dragged to a chosen legal destination.

`ot.solitaire.v1` stores the board, undo history, draw setting and timer timestamps
with guarded localStorage reads and writes. Saved boards are checked for all 52
unique cards, legal face-up runs and foundations before use. The timer starts on
the first move, includes time away from the page, stops on a win and resumes on
undo. New game asks through g's dialog so an accidental press cannot lose a deal.
Unit tests live in `../test/klondike.test.ts`, following the client test glob.
