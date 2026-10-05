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

Pointer capture handles both mouse and touch dragging. A short click delay lets
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
