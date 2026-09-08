# ui

The furniture that is not the table: `auth.tsx` (claim, log in, account menu),
`settings.tsx` with its pure half `prefs.ts`, `presence.tsx`, `avatar.tsx`,
`rating-graph.tsx`, `board-text.tsx`, `mode-tabs.tsx`, `share-link.tsx`,
`site-footer.tsx`, `bits.tsx`, `format.ts`, `grid-entrance.ts` and `title.ts`.

`grid-entrance.ts` is here rather than beside either grid that uses it because
there are two of them and they have nothing else in common: the tools pages'
`hand-grid.tsx` and the preflop puzzle's own chart. It animates cells the
caller already renders, reading `data-r` and `data-c` off them, so a grid gains
an entrance without changing its markup, its focus handling or its shading.

## The page entrance

`enter.tsx` is the whole of it, and it is one system for the whole app: no page
arranges its own entrance and a new page gets one by existing.

`PageEnter` is mounted once, in `../app.tsx`, and writes `data-enter` on the
root element when the route takes the entrance. The rules are in `../app.css`
and animate **the direct children of the routed `<main class="page">`**: each
block slides in from the leading edge with a fade, 200 ms (`--dur-slow`) on
g's `--ease-out`, staggered 50 ms and capped at the sixth block, so the longest
page has opened inside 450 ms.

The contract, in the order it matters:

- **A block is a direct child of `.page`.** That is the whole selector. Nothing
  is tagged, no page imports anything, and a page that adds a section gets it
  in the entrance for free.
- **Transform and opacity only, and `backwards` rather than `forwards`.** A
  block occupies its final space before it animates, so an entrance cannot move
  the page under itself, and the moment it finishes the element is back on its
  own styles with no transform left behind to make a containing block out of.
  `../../e2e/enter.spec.ts` measures the layout shift across an entrance and
  requires zero.
- **A block waiting on the network says so** with `data-enter-ready="no"`,
  which holds it at rest, and flips to `"yes"` when its content lands, which
  enters it with no stagger. A skeleton never slides in, because motion about
  a placeholder is motion about nothing. Five blocks carry it: the top ten and
  the recent matches on home, both lists on watch, and the board on the
  leaderboard.
- **A page that is still fetching shows `PageResting`**, the shape it is about
  to fill, rather than a spinner. The profile and the lazy puzzle use it, and
  the arena has the same frame inline because its heading is already on screen.
- **`useLayoutEffect`, not `useEffect`.** The attribute lands after React has
  put the page in the document and before the browser paints it, so the first
  frame anybody sees is the first frame of the entrance.

**Nothing under `/m` enters.** The table, the match summary and the replay hold
one footprint through a whole hand and `../../e2e/footprint.spec.ts` measures
it, so they keep the motion they have and take none of this. `pageEnters` is
the one place that is decided and `../test/enter.test.ts` pins it. The same
exclusion covers everything with its own motion: toasts, menus, the settings
popover, the presence pill and the match-found alert are none of them page
blocks.

**Reduced motion turns it off completely**, at rest on the first frame, rather
than shortening it.

**Promotion candidate.** This is g-system's shipped `.enter` recipe with the
rise turned into a slide and the beat widened. `.enter` exposes no way to ask
for either, so the variant lives on one selector in `../app.css` and nowhere
else. **Promotion: yes**, as an `.enter` variant with the distance, the axis
and the duration in custom properties. Delete the local copy when it ships.

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
| Accent | `data-accent` | absent (g's own), `ocean`, `jade`, `violet`, `clay` |
| Four colour deck | `data-deck` | absent, `four` |

All three live in one record under `ot.prefs`. **The theme is written twice on
purpose**: g-ui reads its own `g-theme` key at load and stamps the attribute
itself, so `applyPrefs` writes both in the one call that changes it, and nothing
else in this app calls `g.theme()`. Sound is not in that record: it is a separate
module with its own store and its own key, and playing with the sound off in a
light theme is the normal case rather than a contradiction.

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
