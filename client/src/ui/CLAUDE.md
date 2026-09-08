# ui

The furniture that is not the table: `auth.tsx` (claim, log in, account menu),
`settings.tsx` with its pure half `prefs.ts`, `presence.tsx`, `avatar.tsx`,
`flag.tsx` with `country-picker.tsx` and the generated `countries.ts`,
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

## Flags

`flag.tsx` draws the country somebody put beside their own name. Two exports:
`Flag` is the picture, `FlagSlot` is the picture or the same box with nothing
in it.

**An image, never an emoji flag.** The regional indicator pairs render as two
grey letters on Windows, which is most of the people who would ever see one.
The artwork is `flag-icons`' 4x3 SVG set, MIT, committed under
`../../public/flags/` and refreshed by `../../scripts/flags.mjs`, which also
writes `countries.ts` here and its twin in the server. They are committed rather
than pulled from the package at build time: 249 small files are worth less than
a dependency, and only the one a seat asks for is ever fetched.

The flag carries a **hairline drawn inside its own box** (`outline-offset: -1px`
in `../app.css`), because Japan and Switzerland and a dozen others are mostly
white and read as a hole in a light surface without it. Inside, so an outlined
flag and an empty slot measure the same and a footprint test cannot tell them
apart. It is **not decorative**: nothing else on the row says the country, so
the alt text is the country's name.

**`FlagSlot` is for a column, `Flag` is for a sentence.** A seat, the phone
band, the leaderboard, an arena board and a home game's guest list all keep the
box whether or not there is a flag in it, so a flag on one row cannot leave the
rest out of line, and on the table nothing can move by arriving (see
`../table/CLAUDE.md`, "One footprint"). The feed and the watch list print names
in a sentence, where a reserved gap would read as a missing word, so they draw
the flag only when there is one.

`country-picker.tsx` is the **one** control that sets it, mounted by the
settings menu and by your own profile: two copies of "which code did they pick"
would be two chances to send a code the server refuses. It is g's combobox over
249 options with "No flag" first, and the choice is the save, with a toast
saying so. Three things about living with g's control:

- **g owns the field and reads the selection once**, when it wires the control.
  So the picker does not mount until `me` has arrived, and it is remounted (keyed
  on the id and the country) when the answer changes under it, which is a
  different account or the other picker on the page having just saved. Its own
  save needs no remount: g has already written the name into the field.
- **g's choice arrives as a bubbling `change` CustomEvent**, which React's
  synthetic `onChange` never sees, because it is not an input event on an input.
  A native listener on the wrapper is the whole binding.
- **g filters the list by whatever is in the field**, and the field opens
  holding the country already chosen, so a click would offer the one option you
  are already on. Emptying it on focus is what keeps the control a search. That
  belongs in g-system's combobox rather than here, and is flagged.

The options carry no flags of their own: g renders all 249 into the DOM at once,
so a flag per row would be 249 images fetched to show one. The chosen flag sits
beside the field, which is where the answer is.

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
