# ui

The furniture that is not the table: `shell.tsx` (the site's chrome),
`auth.tsx` (claim, log in, account menu),
`settings.tsx` with its pure half `prefs.ts`, `presence.tsx`,
`ready-check.tsx`, `avatar.tsx`,
`picture-dialog.tsx`, `flag.tsx` with `country-picker.tsx` and the generated
`countries.ts`, `rating-graph.tsx`, `board-text.tsx`, `mode-tabs.tsx`,
`share-link.tsx`, `site-footer.tsx`, `segmented.tsx`, `bits.tsx`, `format.ts`,
`grid-entrance.ts` and `title.ts`.

`segmented.tsx` is the two option switcher the home page's play panel is built
from, and `mode-tabs.tsx` is now that component with the modes in it. It is
**g's shipped tabs**, not a new component: g-system ships no segmented control,
and building one in a consumer repo is the defect the design contract names.
The co-ownership rules with g-ui live there in one copy: React renders the
selection once at mount and never writes `aria-selected` again, both handlers
read the selection back out of the DOM, and a value changed from outside is
applied by clicking the tab so that g-ui does the moving.

`grid-entrance.ts` is here rather than beside either grid that uses it because
there are two of them and they have nothing else in common: the tools pages'
`hand-grid.tsx` and the preflop puzzle's own chart. It animates cells the
caller already renders, reading `data-r` and `data-c` off them, so a grid gains
an entrance without changing its markup, its focus handling or its shading.

## The shell

`shell.tsx` is the site's persistent chrome and it is g-system's `.g-shell`:
the seven sections in a sidebar on the left, the page beside it, and under
720px the same sidebar as the off-canvas sheet g ships, behind `.g-scrim` and
opened by a `.g-nav-toggle` in the slim top bar. The sheet, the scrim, the
slide and the hamburger's morph to an x are all g's; the icons are Phosphor at
the regular weight, 20px, and they are used **here and nowhere else in the
app**. What is ours, and why, is written at the top of the shell block in
`../app.css`: the scroll model, `data-sheet`, and `.nav-item`.

**A table has no sidebar beside it at any width.** `sidebarIsSheet` says so for
`/m/...`, next to the two other predicates that say the same thing about the
same routes: `pageEnters` in `enter.tsx` and the guard in `site-footer.tsx`.
The felt, the dock and the hero band size themselves against the window and
`e2e/footprint.spec.ts` holds them to it, so the sidebar there is the sheet and
the toggle is in the top bar.

**The account and the settings move.** They are one component each and the
settings panel is a single popover that the profile page opens by id, so there
is no second copy to hide with a media query: while the sidebar is a sheet the
two sit in the top bar, and while it is a rail they sit at its foot. That is
the one thing the shell asks in JavaScript rather than in CSS.

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

**A media query as a value.** `useMedia` in `bits.tsx` is for a layout that is
two different components rather than one component at two sizes. The hero band
is the case it exists for: a sweep under a thumb and a row of sizes under a
mouse, each with its own meaning for the number keys, so rendering both and
hiding one with CSS would leave two handlers answering the same keyboard. Where
CSS can do the job, CSS does it.

**Keyboard shortcuts and typing.** `isTextEntry` in `bits.tsx` is the one guard:
it treats text fields, textareas, selects and contenteditable as typing, but not
checkboxes, radios, buttons or ranges. Arrow keys stepping a replay must still
work right after someone clicks the "show all cards" switch, which is what a
blanket "is it an input" test got wrong.

## Settings

One panel, `settings.tsx`, at the foot of the sidebar or in the top bar as the
shell decides, replacing a button that cycled the
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
  `@opentable/identity` or an uploaded picture over it. 28 px at a seat, 24 px in
  a row, 56 px on a header.
- **`picture-dialog.tsx`** is a composition, not a component: g's dialog,
  dropzone, slider, buttons and avatar arranged around a canvas. **Promotion:
  the crop stage alone, maybe.** Cropping a square to a circle with a drag and a
  zoom is a thing more than one project wants; the rest of this file is
  Open Table's own copy and its own upload route.

The table's own candidates are in `../table/CLAUDE.md`.

## The ready check

`ready-check.tsx` is the prompt that a matchmade table is waiting on you, and
it is mounted once in `../app.tsx` beside `presence.tsx` for the same reason:
the whole point of it is that it reaches you wherever you are on the site.

It is g's shipped `dialog.dlg` with `.g-progress` counting the window down, and
two rules of its own:

- **The server opens and closes it, and nothing else does.** There is no
  dismiss and Escape is refused, because a browser that closed it locally would
  still be in the check and would still be charged for not answering.
- **One cue per check, on the check rather than on the table it becomes.**
  `presence.tsx` plays the same `yourTurn` cue on `q found`, so it skips its
  own whenever a check announced the table first; a challenge, a home game and
  practice have no check and still get it.
