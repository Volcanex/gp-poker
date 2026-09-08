# ui

The furniture that is not the table: `auth.tsx` (claim, log in, account menu),
`settings.tsx` with its pure half `prefs.ts`, `presence.tsx`, `avatar.tsx`,
`rating-graph.tsx`, `board-text.tsx`, `mode-tabs.tsx`, `share-link.tsx`,
`site-footer.tsx`, `bits.tsx`, `format.ts` and `title.ts`.

## g-ui and React

g-ui.js wires its behaviour layer at load; React mounts later. `useGInit` in
`bits.tsx` asks for a pass over a subtree and stamps it so a second pass is a
no-op. It passes the **wrapper**: g looks for its components inside the node it
is given, never at the node itself.

Four nodes are co-owned, and **their React children must stay constant**:

- the `.copy-btn` in the hand header, where g inserts icons and rewrites the
  label on click;
- the `.copy-btn` in `share-link.tsx`, which is its own component precisely
  because g wires a copy button once, on an element that is already in the DOM,
  and the row appears only the moment a link exists;
- the account `.menu`, which g positions and whose items it binds. The handlers
  call `hidePopover()` themselves so a re-rendered item still closes the menu;
- `.tabs` in `mode-tabs.tsx`, where g owns `aria-selected`, the roving tab index
  and the sliding indicator and handles the arrow keys itself. The tabs render
  `aria-selected` from the mode they mounted with, which React writes once and
  never touches again, and read the selection back out of the DOM on click and
  on key up rather than setting it.

**The slider.** g owns the fill and the readout and syncs them on the input
event. The dock keeps the range React-controlled and replays a native input
event after a programmatic change, so g stays the only thing that computes the
fill. React bails on a set to the same value, so it cannot loop.

**Keyboard shortcuts and typing.** `isTextEntry` in `bits.tsx` is the one guard:
it treats text fields, textareas, selects and contenteditable as typing, but not
checkboxes, radios, buttons or ranges. Arrow keys stepping a replay must still
work right after someone clicks the "show all cards" switch, which is what a
blanket "is it an input" test got wrong.

## Settings

One panel in the top bar, `settings.tsx`, replacing a button that cycled the
theme: the only way to learn what its third press did was to press it twice. It
is g's `.menu` popover holding g's own controls, so the choices are radio groups
and switches and are labelled as such. A menu role over a set of switches
announces the wrong thing.

**Every setting is an attribute on the root element and every value is in CSS.**
`prefs.ts` holds ids and no colours: an accent is `data-accent="jade"` and
`../app.css` says what jade is. That is what keeps the pre-paint script in
`../../index.html` down to three attribute writes with nothing to drift, and it
is why the swatch in the menu can paint itself by carrying the same attribute.

| Setting | Attribute | Values |
| --- | --- | --- |
| Theme | `data-theme` | absent (dark), `light`, `system` |
| Palette | `data-palette` | absent (slate), `felt`, `sky`, `umber` |
| Accent | `data-accent` | absent (g's own), `ocean`, `jade`, `violet`, `clay`, `ember` |
| Four colour deck | `data-deck` | absent, `four` |

All three live in one record under `ot.prefs`. **The theme is written twice on
purpose**: g-ui reads its own `g-theme` key at load and stamps the attribute
itself, so `applyPrefs` writes both in the one call that changes it, and nothing
else in this app calls `g.theme()`. Sound is not in that record: it is a separate
module with its own store and its own key, and playing with the sound off in a
light theme is the normal case rather than a contradiction.

## Palettes

An accent is four variables. A **palette** is the twelve greys the whole site is
built out of, so it colours the felt, the cards, the borders and the page at
once without a component knowing it exists: g's components read only the alias
layer, the aliases read only `--slate-1..12` and `--slate-a1..a12`, and a palette
re-declares those twenty four values. `../palettes.css` holds them and nothing
else. Slate is g's own and the root carries no attribute for it.

**Every block declares the full scale, dark and light.** A block that changed
only the steps it cared about would leave the rest resolved against whichever
theme's slate was last to win, which is one page wearing two palettes. Each
palette therefore has three rules: an unconditional dark one, a light one, and
the same light one inside `prefers-color-scheme: light` for `data-theme="system"`.

Each selector is a pair, `[data-palette="x"][data-theme="light"]` and
`[data-theme="light"] [data-palette="x"]`, so that an element other than the root
can carry a palette and still follow the root's theme. That is what lets the
menu's chip paint itself out of the palette it names. An element carrying a
palette also has to re-declare the aliases that read the scale, which the one
`[data-palette]` rule at the top of the file does: a custom property inherits the
value it computed where it was declared, so a chip left alone would report the
root's grey while sitting on its own.

**A palette arrives wearing an accent** (`PALETTES` in `prefs.ts`): felt brings
`ember`, sky brings `ocean`, umber brings `clay`. Choosing a palette takes its
accent unless the player has already moved off the accent the palette they are
leaving came with, which is the only way to tell a chosen accent from a default
one without storing a second flag. The accent named `ember` and the palette named
`umber` are different things on purpose: one is four variables, the other is
twenty four, and giving them the same name would have made every sentence about
either of them ambiguous.

**To add one:** pick a hue and a chroma ramp in oklch, keep g's lightness step
for step (that is what holds the contrast), emit all twenty four values for dark
and for light, derive each alpha step as the colour that composites to its solid
step over step 1, add the three rules, add the id to `PaletteId` and `PALETTES`,
and nothing else changes. `../../e2e/settings.spec.ts` walks every palette in both
themes and measures text-primary and text-secondary on surface-1 and surface-2,
plus the palette's own accent, and runs axe over the home page and the felt.

**The accents are not the chart tokens.** Those are step 9 solids meant to sit
under large text, and a 13 px button label on one measures about 3:1. The four
here follow the rebrand card's recipe (a fill, a slightly darker hover and edge,
white on top) and every one of them clears 4.5:1.
`../../e2e/settings.spec.ts` reads the computed values back out of the stylesheet
in both themes and checks the ratio, so that claim cannot go stale quietly. It
reads them through a probe element rather than off the custom properties, because
a custom property whose value is another `var()` comes back unresolved, and it
measures display-p3 where it is rather than converting it badly: g's palette is
p3 and this app's accents are hex, so both notations turn up.

The four colour deck is four variables, `--suit-s/h/d/c`, read by one rule each
on the card. Diamonds take the palette's blue and clubs its green, borrowed the
same way the red is borrowed and for the same reason: nothing on this felt means
ok or info.

## Presence

Two cues that a match is yours, both in `presence.tsx` and both outside the table
because the point of them is being somewhere else.

A **"You are playing" pill** in the top bar links back to the match
`../net/session.tsx` last saw you seated at, on every page except that table. It
is only ever for a seat: watching is not something to be late for. The bar does
not wrap and it clips, so the pill drops the opponent's name below 700px and the
long form of its words below 900px.

A **match found while you are elsewhere** raises g's toast with one action that
opens the table. Home still navigates by itself, as it always has, so the toast
is deliberately suppressed there. The sound cue plays wherever you are, including
home: `matchFound` is not a `SoundEvent`, so this reuses `yourTurn`, which is the
packs' notification cue and the nearest honest thing to it.

## Promotion candidates for g-system

- **`rating-graph.tsx`**: a single line over time. g ships `g.chart`, but it
  draws into a node it owns and re-renders by being called again, which fights
  React. **Promotion: yes**, as a React-friendly sparkline. The line stretches to
  its box (`preserveAspectRatio="none"`) and holds its width with
  `vector-effect`, which is why it has no marker: a circle would stretch into an
  ellipse.
- **`board-text.tsx`**: cards as text for dense tables, used by the match lists
  and by the lessons. **Promotion: no.**
- **`avatar.tsx`** is not bespoke. It is g's shipped `.avatar` with its size
  adjusted through `--avatar-size`, around the deterministic SVG from
  `@opentable/identity`. 28 px at a seat, 24 px in a row, 56 px on a header.

The table's own candidates are in `../table/CLAUDE.md`.
