# client

React 19 + Vite front end for Open Table. Served by the server from
`client/dist` in production; in development `vite` proxies `/api` and `/ws`
to `127.0.0.1:8130`.

**Owner:** Gabriel Penman
**Design:** g-system, vendored at `public/g/` (`g.css`, `g-ui.js`, `fonts/`).
Never hand-edit those; re-run `node scripts/vendor.mjs` from the g-system repo.

## Run
- `npm run dev -w client` (port 5180, proxies to the server on 8130)
- `npm run build -w client` then `npx vite preview --port 4173` for the
  built bundle
- `npx tsc -p client/tsconfig.json` typechecks; `npm test -w client` runs the
  unit tests for the pure sizing and label logic

## Shape
- `src/net/` — the wire. `api.ts` is fetch helpers (same-origin, credentialed);
  `socket.ts` is the single WebSocket; `session.tsx` is the provider that owns
  the session, the connection state and the matchmaking queue.
- `src/routes/` — `home.tsx` (queue + leaderboard), `match.tsx` (live and mock
  tables), `raw.tsx` (the profile and hand-replay placeholders).
- `src/table/` — the table itself. `table.tsx` renders one `TableView`;
  `seat.tsx`, `playing-card.tsx`, `timer-ring.tsx`, `action-bar.tsx`,
  `result.tsx` are its parts. `sizing.ts` and `labels.ts` are pure.
- `src/dev/mock.ts` — the scripted table, dev only.
- `src/app.css` — page layout plus the poker-specific pieces. Tokens only.

## Socket contract
The session is a cookie the server sets on the first `GET /api/me`, so the
socket is opened only after that call succeeds. **A server that is not
answering therefore never produces a reconnect storm and never logs a failed
WebSocket connect**: the home page shows its offline state instead.

`socket.ts` holds one connection for the whole app. It reconnects with
exponential backoff (500 ms to 8 s, jittered), pings every 20 s, and buffers
sends while the socket is down. Sends are typed `ClientMsg`; subscribers get
every `ServerMsg` and filter for themselves (`useServerMsg` in `session.tsx`).

Acting sends `{t:'act', m, h: view.h, n: view.n, a, v}` and disables the bar
until a state with a different `h:n` arrives. The server refuses a stale action
with `err`, so a replayed act is rejected rather than misapplied.

## The mock table
`/m/mock` (or any match URL with `?mock=1`) feeds a scripted sequence of
`TableView` states through the same renderer as a live match: deal, bets, three
streets, a showdown, an award, the next hand, then the `end` result. It exists
so the table can be looked at and screenshotted without a server.

- `?step=N` freezes on one step instead of playing. Screenshots use this.
- Clicking any action button advances the script rather than sending.
- Clock deadlines are recomputed when a step is entered, so a step looks the
  same whenever it is reached.

## g-system usage
Everything that g ships is used as it ships: `.btn` and its variants, `.input`,
`.g-slider`, `.table`, `.card`, `.badge`, `.empty`, `.skeleton`, `.kbd`,
`.prose`, `.spinner`, `.copy-btn`, and `g.theme()` behind the theme button.
Bet chips are `.badge` with `.num`, not a bespoke chip.

Three things to know:

1. **`g.init` and React.** g-ui.js wires its behaviour layer at load; React
   mounts later. `useGInit` (in `src/ui/bits.tsx`) asks for a pass over a
   subtree and stamps it so a second pass is a no-op. `.copy-btn` in the hand
   header is the one node g and React co-own: g inserts icons into it and
   rewrites its label on click. Its React children are constant, so React never
   diffs over g's changes. Keep them constant.
2. **The slider.** g owns the fill and the readout and syncs them on the input
   event. The action bar keeps the range input React-controlled and replays a
   native input event after a programmatic change, so g stays the only thing
   that computes the fill. React bails on a set to the same value, so it cannot
   loop.
3. **`.stat` is copied into `app.css`.** The stat tile ships as markup
   (`.card.stat` with `.k`/`.v`) and as a React component, but its CSS rules
   live in the g-system docs app rather than in `g.css`. The three rules at the
   top of `app.css` are that definition verbatim. **Delete them when g-system
   ships `.stat` in `g.css`.**

The accent slot is not overridden. g's default accent is the far end of the
neutral scale, which is the one accent this app uses: the acting seat's timer
ring, the primary action, the raise button. A rebrand would set
`--accent-fill/-hover/-fg/-edge` and nothing else.

## Bespoke components (promotion candidates for g-system)
These four are poker-specific and live here only because g has nothing close.
If any of them stops being poker-specific, build it in g-system, not here.

- **`playing-card.tsx`** — a rank and suit on a surface, plus a face-down and an
  empty-slot state. The empty slot holds the board's width so nothing shifts as
  streets arrive. Red suits use `--danger-text` as the palette's red; nothing
  destructive in this app is red (Fold is `btn-tertiary`), so the meaning colour
  is not overloaded. **Promotion candidate:** no, this is poker.
- **`timer-ring.tsx`** — a countdown ring driven by a server deadline rather
  than a local duration, so a reconnecting client lands on the right remaining
  time. Steps through `--warn-text` and `--danger-text`, holds and greys when
  `clock.paused`. **Promotion candidate: yes.** A deadline-driven ring is
  generic; g ships `.g-progress` and `.g-meter` but nothing that counts down.
- **`seat.tsx`** — name, rating, stack, cards, button marker, last action and
  the ring in one row. **Promotion candidate:** no.
- **`action-bar.tsx`** — fold, check or call, and a raise with presets, a
  slider and a number input, clamped to `legal.min..legal.max`.
  **Promotion candidate: partly.** The "bounded number with presets, a slider
  and a typed input, all clamped to one range" pattern is generic; the poker
  words around it are not.

## Gotchas
- There is no `--surface` token. Use `--surface-1` (page) and `--surface-2`
  (card, panel, bar).
- `TableView.pot` **includes the current street's bets**. `raisePresets` in
  `sizing.ts` depends on that: a pot-sized raise is `myBet + call + (pot +
  call)`. The unit test pins it.
- The felt caps its column at 680 px and centres it. The table has to read in
  one glance, so it never spreads to the width of the window.
- Reduced motion is respected everywhere: cards stop dealing, chips stop flying
  and the rating stops counting, but every state change is still legible.
  NumberFlow does this itself through `respectMotionPreference`.
- `.result-scrim` sits below the top bar via `--top-h`. If the bar's height
  changes, change that variable, not the scrim.
