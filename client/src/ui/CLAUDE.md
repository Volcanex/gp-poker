# ui

The furniture that is not the table: `auth.tsx` (claim, log in, account menu),
`settings.tsx` with its pure half `prefs.ts`, `presence.tsx`, `avatar.tsx`,
`picture-dialog.tsx`, `rating-graph.tsx`, `board-text.tsx`, `mode-tabs.tsx`,
`share-link.tsx`, `site-footer.tsx`, `bits.tsx`, `format.ts` and `title.ts`.

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

## Profile pictures

`avatar.tsx` takes an `avatarV` beside its seed. Above zero it draws
`/api/avatars/<id>?v=N`; the generated SVG is the element's **background** and
the `<img>`'s `onError`, so a picture still decoding and a picture that has been
removed both look like the avatar that was always there rather than like a hole.
There is no loading state to design because the fallback is already a picture of
this person. Read the version off a payload through `avatarVersion()` in
`../net/adapt.ts`: absent and zero have to mean the same thing.

`picture-dialog.tsx` is where a picture is chosen, opened from a button beside
your own avatar on your profile and from the picture row in the settings menu.

**The crop and the encode happen in a canvas, here.** A phone photo is four
thousand pixels wide and eight megabytes; a seat is twenty-eight. Shrinking it in
the browser makes the upload 120 KB and leaves the server with a magic-number
check instead of a native image library, which on this box would mean a build
dependency, a CVE feed and a rebuild on every Node upgrade in exchange for
re-encoding something already the right size. What is sent is a 256 square, four
times the largest place a picture is drawn.

The budget is met by measuring, never by assuming: webp at four qualities from
0.85 down, then, for a browser with no webp encoder, png at three sizes, because
quality is not a dial on a png. `createImageBitmap` with
`imageOrientation: 'from-image'` is what stops a phone portrait uploading
sideways, since a canvas does not apply EXIF orientation and an `<img>` does.

Two things about it are g-shaped rather than obvious:

- **The dropzone and the crop editor are separate components, not two branches
  of one.** g-ui appends a file list into the dropzone it wires, and React knows
  nothing about that child: swapping `className` on the same `<div>` left the
  chosen file's chip sitting above the crop. Different component types at the
  same position always remount, which takes g's DOM with them.
- **`useGInit` is given a wrapper, never the g component itself.** `g.init(el)`
  looks *inside* the node it is handed, so a ref on the `.g-dropzone` wires
  nothing and the file input goes on firing a change event nobody listens to.
  That is the same rule the four co-owned nodes above follow.

The crop stage takes a drag **and** the arrow keys, and its key handler stops
the event rather than only preventing the default: the arrow keys step a replay
elsewhere in this app, and a modal dialog's keydown still reaches the document.

And one about where it is mounted: the settings menu's dialog is rendered
**outside** `.settings-menu`, as a sibling. A popover is a scope as well as a
box, and `.settings-menu .g-slider` is 108 px wide, so a zoom slider rendered
inside the menu silently inherited a width meant for the volume control. A modal
dialog is in the top layer either way, so nesting it there bought nothing.

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
  `@opentable/identity` or an uploaded picture over it. 28 px at a seat, 24 px in
  a row, 56 px on a header.
- **`picture-dialog.tsx`** is a composition, not a component: g's dialog,
  dropzone, slider, buttons and avatar arranged around a canvas. **Promotion:
  the crop stage alone, maybe.** Cropping a square to a circle with a drag and a
  zoom is a thing more than one project wants; the rest of this file is
  Open Table's own copy and its own upload route.

The table's own candidates are in `../table/CLAUDE.md`.
