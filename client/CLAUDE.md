# client

React 19 + Vite front end for Open Table. Served by the server from
`client/dist` in production; in development `vite` proxies `/api` and `/ws` to
`127.0.0.1:8130`. See the repo root `CLAUDE.md` for the product and the wire.

## Run
- `npm run dev -w client` (port 5180, proxies to the server on 8130)
- `npm run build -w client`, then `npx vite preview --port 4173` for the bundle
- `npx tsc -p client/tsconfig.json` typechecks
- `npm test -w client` runs the unit tests for the pure logic. `vitest.config.ts`
  narrows the glob to `src/test/`, because vitest's default picks up a
  spec file anywhere and would try to run the Playwright suite in node.
- `npm run e2e -w client` runs that suite; `npm run e2e:update -w client`
  rewrites the screenshot baselines. See `e2e/CLAUDE.md`.

`tsconfig.json` includes `../packages/engine/src/vendor.d.ts`: the client
compiles the engine's TypeScript source directly, so it needs the same ambient
declaration for `phe` that the engine's own tsconfig provides.

## Where things are
| Directory | What, and its own doc |
| --- | --- |
| `src/net/` | the wire: REST shapes, the single socket, the session, and `src/net/adapt.ts` as the one place a transitional field is read |
| `src/table/` | the felt, the dock and the one-footprint rule |
| `src/analysis/` | equity, outs and hand names in a web worker, plus the practice strip and the replay panel |
| `src/replay/` | re-deriving a stored hand and rehashing its seed in the browser |
| `src/routes/` | the pages, including `src/routes/learn/` which has its own doc |
| `src/tools/` | the pages at `/tools` |
| `src/puzzles/` | the daily puzzles |
| `src/chat/` | table chat |
| `src/ui/` | settings, presence, the account menu and the g-ui seam |
| `src/sound/` | the sound module and its packs |
| `src/dev/mock.ts` | the scripted table the e2e suite drives (documented in `e2e/CLAUDE.md`) |
| `e2e/` | the Playwright suite |

`src/app.tsx` mounts the routes, `src/app.css` is page layout plus the
poker-specific pieces, and `src/test/` holds the unit tests for everything pure.

**Every page enters the same way and no page arranges it.** The direct children
of a routed `<main class="page">` slide in from the leading edge, staggered,
driven by `src/ui/enter.tsx` and the rules beside `.page` in `src/app.css`. A
block that fetches carries `data-enter-ready`; nothing under `/m` enters at all.
The contract is in `src/ui/CLAUDE.md`.

## The mark
`public/favicon.svg` is a spade on g-system's dark ground with both colours
written as literals, because an icon cannot read a custom property.
`public/favicon-32.png`, `public/apple-touch-icon.png` (full bleed, iOS applies
its own mask) and the 1200x630 `public/og.png` link card are rendered from it in
a browser, not drawn by hand: change the SVG and re-render rather than editing a
PNG. The head that a crawler sees is built server side, in `server/src/meta.ts`.

## Design: g-system
Vendored at `public/g/` (`public/g/g.css`, `public/g/g-ui.js`,
`public/g/fonts/`). **Never hand-edit
those**; re-run `node scripts/vendor.mjs` from the g-system repo.

Everything g ships is used as it ships: `.btn` and its variants, `.input`,
`.switch`, `.g-slider`, `.table`, `.card`, `.badge`, `.empty`, `.skeleton`,
`.kbd`, `.prose`, `.spinner`, `.copy-btn`, `.menu[popover]` and `dialog.dlg`.
Bet chips are `.badge` with `.num`, not a bespoke chip. Where a component has to
be restyled, it is restyled **through g's own slots**: the inert ghosts in the
dock's hand-over state set `--_fill`, `--_fg` and `--_edge` and take a dashed
border rather than being dimmed copies, because a button at 40% opacity is a
button nobody can read and axe says so.

**The accent slot is not overridden.** g's default accent is the far end of the
neutral scale, and that is the one accent this app uses: the acting seat's border
and clock bar, the winning five at a showdown, the primary action, your own row
on the leaderboard. A rebrand would set `--accent-fill/-hover/-fg/-edge` and
nothing else. The four user-chosen accents in settings are a separate thing with
their own contrast rules (`src/ui/CLAUDE.md`).

**Two docs-app rules are copied into `src/app.css`**: `.stat` (the stat tile) and
`.switch-row` ship as markup and as React components, but their CSS lives in the
g-system docs app rather than in `public/g/g.css`. Both copies are marked in
`src/app.css`.
**Delete them when g-system ships those rules.**

How g-ui's behaviour layer and React share the DOM, and which nodes are
co-owned, is in `src/ui/CLAUDE.md`.

## Keep the engine out of the eagerly loaded routes
`@opentable/engine` pulls in `phe`, whose evaluator carries a large lookup table.
The replay route and `/puzzles/hand` are lazy loaded to keep roughly 80 kB
gzipped out of the bundle everyone loads to play, and `src/analysis/worker.ts` is
the only module that imports `@opentable/equity`'s root for the same reason.
Importing either from the table, the match summary or a tool would undo it
silently. `src/table/best-five.ts` exists only because of this rule.

## Gotchas
- There is no `--surface` token. Use `--surface-1` (page) and `--surface-2`
  (card, panel, bar). Style only through the alias tokens, never a raw hex or a
  raw scale step.
- **`--text-placeholder` is for the hint inside an empty field, nothing else.**
  It measures 3.68:1 on the page ground and 3.43:1 on a panel, below AA for
  anything a reader has to read, and axe says so. Everything in this app that
  carries information is `--text-secondary` (9:1): the preset amounts, the key
  legend, the "you" badge, the mode beside your rating, a rating deviation, a
  side pot, the replay's hints and notes. The only use left is a background, on
  the paused clock bar. `--text-muted` is not a third step, it is an alias of
  `--text-secondary`.
- Reduced motion is respected everywhere: cards stop dealing, chips stop flying
  and ratings stop counting, but every state change stays legible. NumberFlow
  does this itself through `respectMotionPreference`.
- Data tables scroll inside their own `.table-wrap`; the page never scrolls
  horizontally, including at 390 px.
