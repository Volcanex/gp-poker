# tools

The pages at `/tools`: the range explorer (`ranges.tsx`), the pot odds trainer
(`odds.tsx`) and the opening explorer (`explorer.tsx`). `index.tsx` exports
`toolsRoutes`, which is what `../app.tsx` mounts, so a new tool is one file plus
one line. `cards.tsx` is the shared card pickers, `hand-grid.tsx` the shared
13 by 13 grid, `ramp.ts` the heat ramp and entrance geometry both grid pages
read, and `grid-legend.tsx` the row that explains a ramp. Each file's own header
says what that page is for; what follows is the part that is not visible from
any one of them.

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

`hand-grid.tsx` owns the layout, the roving tab index, the paint gesture and the
entrance across 169 buttons; what a cell reads and how it is shaded is the
caller's, through `cell`. That split is the reason one page can paint a range on
the grid and another shade it by a frequency without either reimplementing arrow
key navigation. Add a third view of the grid by supplying cells, not by forking
it.

## The ramp is two variables, and it is capped for a reason

`ramp.ts` is the whole colour model, and `grid-legend.tsx` draws its swatches
from the same two functions the cells use, so a legend cannot drift from the
grid it explains. A shaded cell sets `--_f`, how much of the ramp hue is mixed
into `--surface-2`, and `--_h`, how far that hue has travelled from `--chart-1`
to `--chart-5`. Two variables rather than one because a single hue at rising
strength is exactly the thing that reads as one colour; the travel from blue
through violet to magenta is what makes a value legible across a grid at a
glance. Big blinds won is signed, so it diverges from the surface towards
`--ok-text` and `--danger-text` with no hue travel at all: the second variable
would be claiming something the data does not have.

`HEAT_CAP` and `DIVERGE_CAP` are contrast, not taste. The cells carry ten pixel
numbers in `--text-primary`, and in dark every chart colour is lighter than the
ground while in light every one is darker, so contrast falls as heat rises in
both themes at once. The caps are the last mix percentage that still clears 4.5
to 1; the measured numbers are in `ramp.ts`. Raising one to get a more saturated
top of ramp makes the number on the hottest cells unreadable, which is the one
thing the grid exists to show. Nothing about pairs, suited or offsuit is ever
encoded on the ramp: that tiering is the grid's furniture, and mixing it in
would read as a second variable that is not there.

## Wholesale changes animate, painting does not

The grid enters in a wave that radiates from its centre whenever `wave` changes,
and on mount. A caller must bump `wave` only when the whole grid means something
new: another preset, another seat, another shade, a new slider position. It must
not on a single cell paint. Dragging a range across the grid fires a change per
cell, and each one would blank the grid and restart the entrance under the
pointer. In `ranges.tsx` the split is structural rather than remembered: every
wholesale change goes through `apply()`, which bumps the wave, and `paint()` and
the notation field never call it.

A run of wave changes settles into one entrance rather than sixty, because a
dragged slider is otherwise a wave per step. The mechanism is
`useGridEntrance` in `../ui/grid-entrance.ts`, shared with the preflop puzzle's
chart, which draws its own grid and has no ramp at all. It animates the plain
buttons imperatively rather than making them 169 `motion.button` elements,
which is what keeps the roving tab index, the paint gesture and the shade
exactly as React renders them; only opacity and a transform are ever touched,
so nothing on either page moves while a grid enters. Reduced motion skips the
whole thing.

`../test/tools.test.ts` covers the pure parts, including the ramp mapping and
the centre-out ordering.
