# tools

The pages at `/tools`: the range explorer (`ranges.tsx`), the pot odds trainer
(`odds.tsx`) and the opening explorer (`explorer.tsx`). `index.tsx` exports
`toolsRoutes`, which is what `../app.tsx` mounts, so a new tool is one file plus
one line. `cards.tsx` is the shared card pickers and `hand-grid.tsx` the shared
13 by 13 grid. Each file's own header says what that page is for; what follows
is the part that is not visible from any one of them.

## Nothing here evaluates a hand on the main thread

The range explorer and the pot odds trainer import only the **evaluator-free
subpaths** of `@opentable/equity` (`/cards`, `/range`) and send every actual
computation to the worker in `../analysis/`. That is what keeps `phe`'s lookup
table out of the bundle these pages load, and it is why painting a range stays
smooth while a twenty thousand deal preflop sample runs underneath. Importing
the package root from any file here would undo it silently.

## The opening explorer is the one tool that reads the server

Every other page here is arithmetic a browser can do. What the site itself did
preflop is not, so `explorer.tsx` fetches `/api/explorer` and only picks the
selection, shades the grid and reads one cell out at a time. All the tallying is
`server/src/explorer.ts`. It is also the one route on the server that is
cacheable rather than `no-store`, because it is the same public aggregate for
everybody.

## The grid is shared, the cells are not

`hand-grid.tsx` owns the layout, the roving tab index and the paint gesture
across 169 buttons; what a cell reads and how it is shaded is the caller's,
through `cell`. That split is the reason one page can paint a range on the grid
and another shade it by a frequency without either reimplementing arrow key
navigation. Add a third view of the grid by supplying cells, not by forking it.

## The pot odds trainer is built on reserved boxes

A trainer is answered in a rhythm, so nothing on `odds.tsx` may move between
one state and the next. Every box whose contents change is given its size up
front: the two figures, the price slot, the spot line, the keyboard hint and
each score cell. The reveal goes further and is **always drawn**, empty bars
and a placeholder line included, so the answer arrives under the buttons rather
than pushing the record down the page; that is why its box is identical before
and after by construction rather than by a min-height somebody has to keep
true. Both answer buttons and the next one are also always present, one of the
three disabled, for the same reason. `../../e2e/odds.spec.ts` compares the
boxes across an answer at three widths **and for both answers**, because a
stylesheet can break this silently and the two verdicts are not the same
width: the wrong answer's badge is the wide one, which wraps the sentence at
phone widths where the right answer's does not. A reserve one line short
passes on a right answer and slides the record on a wrong one.

The board is laid out so a five card river never wraps at phone width: a board
that wraps on the river and not on the flop is a page that changes height
between spots.

The streak steps tone at **three, five and ten** (`streakTone`), and a wrong
answer flags the tile instead. The tile carries the colour as a wash, an edge
and a shipped badge; the figure itself stays on `--text-primary`, because a
coloured number at that size is the one thing here that has to stay readable.

## One key holds the record and the settings

`ot.odds` is the record (right, total, streak, best) **and** the two practice
settings: the ten second timer and which streets get dealt. They are one thing
to a player, and every field takes a default on read, so a record written by an
older build still loads. The timer starts when the equity lands rather than
when the spot is dealt, since the buttons are dead until then. A change to the
streets applies to the next deal, not to the spot on screen.

`../test/tools.test.ts` covers the pure parts.
