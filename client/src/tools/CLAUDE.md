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

`../test/tools.test.ts` covers the pure parts.
