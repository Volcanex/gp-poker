# e2e

The Playwright suite. `npm run e2e -w client`, config in
`../playwright.config.ts`, baselines in `__screenshots__/` and updated with
`npm run e2e:update -w client`. `table.ts` is the shared kit.

The webServer builds the client and serves the bundle with `vite preview`. The
mock routes need no server and `stubApi` in `table.ts` fakes the endpoints the
pages around them ask for, so a run is identical whether or not a dev server
happens to be up.

## What the suite drives

`../src/dev/mock.ts` is the scripted live table, dev only. Both scripts end on a
showdown and hold it: the heads-up one on a hand you lose, the six-max one on the
hand that takes the table. `?practice=1` stamps `format.practice` over either
script, which is how the analysis strip is driven without a server, and
`?watch=1` drops the seat.

`?runout=1` runs a third script instead of either of them: an all-in run-out,
both hands up from the moment the betting closed and the board arriving a
street at a time behind a count. It is a script of its own rather than steps
spliced into the heads-up one, because every spec here freezes a step by
number and a step inserted in the middle moves every picture after it.

The mock deals in the names people actually get (two CamelCase words, up to
sixteen characters), because a mock dealing seven-letter lowercase names hid a
truncation defect no test could see.

## The stub

`stubApi` serves the leaderboard, the feed, the site counters, the live tables,
the bot roster and both kinds of shared link as well as your own account, so the
baselines show those pages populated rather than showing eight pictures of an
offline state. Its timestamps are offsets from now, sitting in the middle of
their bucket, because the feed prints "2h ago" and a pinned date would read
differently every day.

**The two profiles are the exception to that**: `/api/users/:name` serves a
rated player and an unrated one, and their dates are pinned rather than offset,
because the profile prints "26 Jul 2026" and not "3d ago". An offset would
redraw every profile baseline at midnight. The rated one is rated in both modes
so the percentile column has two rows to fill.
It also serves your own profile and answers every `/api/avatars/**` with
`fixtures/avatar.png`, and one scripted player on the mock table carries an
`avatarV`, so the table baselines cover the uploaded-picture path rather than
only the generated SVG.

The two link-landing pages, an invite and a home game lobby, are stubbed **from
the visitor's side** rather than the host's, because that is the side a link is
for: somebody else's invite to accept, and a lobby with three of its six chairs
filled and none of them yours.

The one thing no route can stub is the websocket, so the home page's baseline
says the connection dropped, which is true.

**`formats.spec.ts` is the exception, and it replaces the websocket rather than
routing it.** Its `fakeSocket` puts a stand-in `window.WebSocket` in front of
the bundle with an init script: it says `hi` on open, because the real socket
buffers every send until that arrives, records what the page sends, and hands
the test a `push` so it can be the server. That is how the ready check modal is
driven with no server at all. Push nothing before the socket exists: it is
opened only once `/api/me` has answered, which is why `push` waits for it.

`admin.spec.ts` is the one spec that stubs `/api/me` as an admin, which it does
by registering its own handler **after** `stubApi`, for the reason below. Every
other spec sees the ordinary player, so the bar is not in any other baseline.

**A theme has to be stamped into `ot.prefs`, not into g's key.** The app's
`applyPrefs` reads `ot.prefs` on mount and reapplies it, overwriting whatever
`g-theme` or the attribute already said, so `setTheme` writes into `ot.prefs`
(merged with whatever is already there, so it does not clobber other prefs a
test set first) rather than either of those. Before 2026-09-08 it wrote
`g-theme` and the attribute directly, which `applyPrefs` undid on mount, and
every baseline in `__screenshots__` whose name ends in `-light` was quietly a
picture of the dark theme. `setPrefs` is the same bargain for every other
setting: a patch merged into `ot.prefs` before the page loads, which is how the
hand layout and card size specs put the band into a state a URL cannot ask for.

**Playwright runs the last matching route handler**, so a catch-all has to be
registered first and the fixtures after it. Registered the other way round the
catch-all swallows everything: this stub served 404 to every call for its whole
life, which is why the accessibility run never saw a logged-in top bar, and why
the contrast defect living in it went unreported by a suite that checks contrast.

The replay's fixtures are a real recorded hand and its match, captured from the
server into `fixtures/`. That page is a re-derivation: the engine replays the
actions and the fairness panel rehashes the seed, so a mock cannot stand in for
it.

## The specs

| Spec | Guards |
| --- | --- |
| `formats.spec.ts` | the play panel's shape (three switchers, one button, four one-line ways to play), the pin and the remembered choice, the ranked gate disabling ranked, no middle dot anywhere on the page, the ready check modal end to end, and the level and badges on a profile |
| `footprint.spec.ts` | the boxes and zero layout shift, playing and watching, that the dock is one height in all three states, and that the strips tile the grid |
| `ergonomics.spec.ts` | phone target sizes, the primary action in the bottom quarter, the sizing model and clamping, a pre-action firing, and the ring at 768, 1280 and 1920 |
| `hero-band.spec.ts` | the v2 band's one footprint through a hand at 390 and 1280, sitting out, the felt giving up your seat, the decision line, the sizes and the keys, and the hand's three layouts and three sizes: ten pictures, the card at the size the setting names, and the cards ending before the controls start |
| `showdown.spec.ts` | your cards face up through a lost showdown and after the end, the winning five, the award chip clear of the pot label |
| `access.spec.ts` | axe-core per state with zero serious or critical, a keyboard-only decision, tab reachability, and typing in the field not triggering the shortcuts |
| `practice.spec.ts` | the strip is on a practice table and off a rated one, that it reads, and that a practice table keeps one footprint with zero layout shift |
| `chat.spec.ts` | opening, sending and closing the panel leave the header, felt and dock in identical boxes, at both widths |
| `reduced-motion.spec.ts` | the same information with the motion emulated off |
| `enter.spec.ts` | the page entrance: every block at rest inside 600ms, a fetching block held until its content lands, zero layout shift across an entrance, nothing under `/m`, and nothing at all under reduced motion |
| `avatar.spec.ts` | a photograph cropped in the dialog leaves as a webp or png square under 120 KB, and the account row draws the new version |
| `settings.spec.ts` | a choice surviving a reload, the pre-paint stamp, every accent's and every palette's contrast in both themes, axe under each palette, the accent a palette arrives with, the four colour deck, and the menu itself |
| `replay.spec.ts` | a recorded hand scrubbed back and forth leaves nothing behind and nothing outside the felt, and still verifies |
| `odds.spec.ts` | the pot odds trainer's reserved boxes across an answer, at 390 and 1366, and axe in both themes. No baselines: the assertion is the geometry |
| `puzzles.spec.ts` | the preflop chart's entrance: every cell ends visible, on the first spot and the next, and the page does not reflow while it runs |
| `shell.spec.ts` | the sidebar as a named landmark and the section you are in, the sheet on a phone opening and shutting by toggle, Escape, scrim and a link with the focus put back, a shut sheet out of the tab order, and a table keeping the whole window |
| `admin.spec.ts` | the admin bar, the annotate flow from shortcut to posted ticket, the tickets pages, and that a player gets none of it |
| `screenshots.spec.ts` | 198 baselines: sixteen states at 360, 390, 430, 768, 1366 and 1920 in dark and light, and three at 390 and 1366 in the games room |

## Reading a baseline diff

**Read the diff before you accept one.** The suite runs with reduced motion so a
card mid-deal cannot decide a baseline, and masks the four things that cannot be
pinned to a pixel: the pot figure mid-count, the depleting turn bar, the seconds
beside it and the hand-end countdown.

**It also waits for every image to decode.** Avatars are inline SVG data URIs
that never touch the network, which makes it easy to assume they are there, but
the decode is still asynchronous: a shot taken between layout and paint differs
from one taken after by a few hundred pixels, and the whole suite began flaking
the day the stub started serving a logged-in top bar.

The suite runs two workers, not one per core: eight states at 1920 in two themes
is a lot of full-page rendering, and four browsers doing it at once on this box
time out on each other rather than on anything real.

## What it does not cover

The replay page draws a hand fetched from the API and the suite deliberately runs
without one. And the mock has no uncontested pot, so that rule is pinned in the
unit tests on `readShowdown` (`../src/test/sizing.test.ts`) instead.
