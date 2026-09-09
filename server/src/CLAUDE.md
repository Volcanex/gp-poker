# src

The server's own modules. `match/`, `ws/` and `bots/` have their own docs; this
file covers the flat files and the subsystems that live in exactly one of them.

| File | Owns |
| --- | --- |
| `config.ts` | env from the repo-root `.env` via `process.loadEnvFile`, no dotenv dependency. `DATABASE_URL` and `SESSION_SECRET` are required; `PORT` and `HOST` default to 8130 and 127.0.0.1. Under vitest it resolves `TEST_DATABASE_URL` instead (`../test/CLAUDE.md`). Also `botCount`, `ladderEnabled`, `ladderPauseMs`, `arenaEnabled`, `explorerLagMs` |
| `db.ts` | the `postgres` client and every typed query the rest of the server uses |
| `auth.ts` | guest minting, scrypt password hashing, session cookies |
| `userView.ts` | `UserRow` to wire `UserSummary` |
| `routes.ts` | all REST endpoints |
| `matchmaking.ts` | the in-memory queues, their tick, the ranked gate and match creation |
| `ready.ts` | the ready check: pending tables, who has accepted, and no-show cooldowns |
| `challenges.ts` | play a friend: a link instead of a queue |
| `home-games.ts` | the six-max version of that link, as a lobby |
| `arena.ts` | the hourly competitive event |
| `ladder.ts` | bots playing each other so their ratings spread out |
| `chat.ts` | the pure half of table chat: `cleanChatText` and `ChatLimiter` |
| `admin.ts` | the admin gate's own routes: the tickets the annotation layer writes |
| `avatars.ts` | the pure half of profile pictures: the size cap, the magic-number sniff and the per-user rate limit |
| `insights.ts` | the pure derivation behind `/api/users/:name/insights` |
| `explorer.ts` | the pure derivation behind `/api/explorer` |
| `meta.ts` | what a pasted link shows, plus `/robots.txt` and `/sitemap.xml` |
| `health.ts` | `/health`, five checks (see the repo root `CLAUDE.md`) |
| `countries.ts` | **generated.** The country codes a flag may be set to, and `readCountry` |
| `pgError.ts` | `isUniqueViolation`, the one place a driver error code is read |
| `app.ts` | builds the Fastify instance without listening, so tests can inject into it and control timing themselves |
| `index.ts` | thin: build, start matchmaking, listen, graceful shutdown |

## db.ts

`postgres.camel` transforms column names both ways. `applySchema()` applies
`../db/schema.sql` idempotently inside a transaction holding a
`pg_advisory_xact_lock`, so concurrent boots (parallel test workers, a rolling
deploy) do not race on `create extension if not exists` and friends. Postgres's
own IF NOT EXISTS is not safe under concurrency.

`sql.json()` needs a value typed with an index signature, and named interfaces
like `MatchFormat` do not have one even though they are plain JSON. The `jsonb()`
helper is the one cast boundary for that mismatch.

## Auth model

A guest is minted on any request that lacks a valid `ot_session` cookie
(`requireUser`, used by `/api/me` and anything else that should always have a
current user). The cookie is httpOnly, `SameSite=Lax`, 90 days, and `secure` when
`X-Forwarded-Proto: https` (nginx terminates TLS) or the request itself is https.

Guest names come from `@opentable/identity`'s `generateName`: a two-word
CamelCase name, retried up to 4 times on collision, then three-word names until
one is unique. **Guests are identified by the `guest` boolean column, not a name
prefix.** `guest-` stays reserved in `validateName` so nobody can claim a name
that looks like the old convention. Claiming sets `name` and `password_hash` on
the **same** row (`guard: guest = true`), so rating and history carry over.
Password hashing is `crypto.scrypt`, stored as `salt:hash` hex.

The websocket path uses `resolveSessionUser` instead and does not mint
(`ws/CLAUDE.md`).

## The admin gate and tickets

`users.admin` is one boolean and one person has it. It is granted in
`../db/schema.sql` by an `update ... where id = '...' and admin = false`, which
re-runs harmlessly on every boot: a deploy is where a grant belongs, and nobody
has to touch the live rows by hand to make one.

`requireAdmin` in `auth.ts` sits beside `requireUser` and differs from it in one
way that matters: **it never mints**. `requireUser` exists so a link works for
somebody who has never been here, which is exactly wrong for a route that is
about to refuse them anyway. It sends its own 403 and answers null, so a route
hands the reply straight back to Fastify. `/api/me` adds `admin: true` for an
admin and **omits the key entirely** otherwise, so nothing about the admin layer
is on the wire for a player at all.

`admin.ts` holds every route behind that gate: `POST /api/tickets` and
`GET|PATCH /api/admin/tickets[/:id]`. A ticket is an annotation made on the
running site, and its shape is all context: the `url` and `path` it was made on,
the `viewport` (width, height, dpr, theme) it was seen at, `targets` (a CSS
selector path, the box, the trimmed text and the aria label for each element
that was pointed at), and `drawing`, a PNG data URL of the strokes drawn over
them. `title` is the note's first line, derived on the way in so a list reads as
sentences rather than as truncated paragraphs. `page_shot` is a slot nothing
writes yet.

Three limits are worth knowing. The drawing is capped at **1.5 MB**, and the
route carries its own `bodyLimit` well above that so the refusal is ours and
carries a sentence rather than being Fastify's generic payload error. Ticket
creation is limited to **one a second per user**, which is about a stuck save
button rather than about abuse; `clearTicketRate()` is the seam the suite uses,
since writing several tickets in a row is exactly what the limiter refuses. And
**the list never selects `drawing`**: twenty tickets would otherwise be twenty
PNGs nobody is looking at.
## Profile pictures

Three columns on `users`: `avatar bytea`, `avatar_type text` and
`avatar_v integer not null default 0`. The bytes live on the row rather than on
disk because there is one box and one backup path, and a 120 KB square per
player is nothing beside the hand histories.

**`select *` on `users` is gone.** `USER_COLS` in `db.ts` lists every column
except `avatar`, and every query that reads a user goes through it. A session
lookup runs on every request; pulling 128 KB of image through the driver to
answer "who is this" is the kind of cost that only shows up once enough people
have uploaded one. `getUserAvatar` is the one query that reads the bytes.

**`avatar_v` is bumped on every change, including a removal.** It is what makes
`/api/avatars/:id?v=N` immutable: a version is only ever handed out beside the
bytes it belongs to, so a new picture is a different URL rather than a cache to
invalidate, and taking a picture off has to move the number too or a page
holding the old URL would keep an answer it was promised would never change.
Zero means no picture, which is what every payload carrying a display name
reports when there is none: `/api/me`, `/api/users/:name`, the leaderboard,
`/api/recent`, `/api/live`, arena standings and podiums, home game seats, and
`SeatView` on the wire.

The three routes:

- **`PUT /api/me/avatar`** takes the image as the raw body, not base64 in a JSON
  envelope. `bodyLimit` is 128 KB on the route (`AVATAR_MAX_BYTES`), well under
  Fastify's 1 MB default, so a picture the client failed to shrink is refused by
  the framework before any of it is held. The content type is a claim, not
  evidence: the magic number decides what the bytes are and the header only has
  to agree with it, because whatever is stored is served back to a browser under
  the type this route recorded. One change per ten seconds per user
  (`AvatarLimiter`, in memory).
- **`DELETE /api/me/avatar`** is deliberately not rate limited. The limiter
  exists to stop a script writing 128 KB in a loop; a removal writes two nulls,
  and somebody who has just uploaded a picture they dislike should not be told
  to wait.
- **`GET /api/avatars/:id`** serves the bytes, with a route-level `onSend` that
  overrides `app.ts`'s blanket `no-store` on `/api` the way `/api/explorer`
  does. `?v=` present means `public, max-age=31536000, immutable`; absent means
  a short max-age, because "whatever this player looks like now" is a question
  whose answer moves. **404 is not an error here**: it is what the client draws
  the generated avatar for.

**Nothing on the server decodes an image.** The client crops and encodes a 256
square in a canvas, so this side needs a magic-number check rather than a native
image library, which on this box would be a build dependency, a CVE feed and a
rebuild on every Node upgrade in exchange for re-encoding something already the
right size. `app.ts` registers an `image/*` content type parser so the route
sees the bytes and can answer for itself, rather than the framework refusing an
unparseable type with a 415 that says nothing useful.

`MatchSeat` carries `avatarV` too, stored in the match row's `seats` jsonb, so a
seat and a finished match read back as they looked rather than as the players
look now. It is frozen at match creation, like the name and the rating beside
it.

## Ratings are per mode

A rating belongs to a (user, mode) pair, the way a chess site keeps bullet and
blitz apart. The `ratings` table is the home of the Glicko-2 state:
`(user_id, mode)` primary key, holding the same columns `users` used to
(`rating`, `rd`, `volatility`, `rating_at`, `peak_rating`, `peak_at`, `matches`,
`wins`, `losses`, `draws`).

Rows are created lazily, on the first **finished** match in that mode, so a guest
who never plays leaves nothing behind. Every read goes through
`getRating(userId, mode)`, `getRatingsFor(userId)` or
`getRatingsForUsers(ids, mode)`, which synthesise a fresh 1500/350/0.06 for a
missing row: "has not played this mode" and "is unrated in this mode" are the
same thing, and no caller has to special-case it.

**The matching columns on `users` are legacy.** Nothing in the server reads them.
`db.finishMatch` mirrors the heads-up row into them after every heads-up match so
anything outside this codebase still sees something sane, and `../db/schema.sql`
backfills `ratings` from them once with a plain
`insert ... select ... on conflict do nothing`, which re-runs harmlessly on every
boot. Delete the columns when nothing outside the server wants them.

`peak_rating` and `peak_at` mean "the best this player has ever been in this
mode, and when". Everyone starts at the default 1500, so a first match that went
badly peaks at 1500 with a **null** `peak_at`: nothing was exceeded, so there is
no moment to point at. Both branches of the upsert in `db.finishMatch` have to
agree about that, and originally they did not, which made `peak_at` depend on
whether the rating row happened to exist already. The schema backfill creates
rows for existing users, so under a parallel test run it sometimes did. `peakAt`
on the wire is ISO or null.

Everything downstream keys off the match's mode: the queue enters a player at
their rating for the mode they queued for, `MatchSeat.rating` (and so
`SeatView.rating`) is the mode's rating, bot picks compare on the mode's rating,
`rating_history` rows carry a `mode`, and the provisional flag, peak and
win/loss/draw counters are all per mode. `userView.ts`'s `isProvisional`
delegates to `@opentable/rating`'s own threshold rather than keeping a second
constant; the leaderboard SQL's `rd <= 110` is the one unavoidable duplicate,
since SQL cannot call into the package, and it is commented at the query.

## Countries

A player may put a flag beside their name: `users.country`, a lowercase ISO
3166-1 alpha-2 code or null for none, which is what everyone starts as.
**Nothing infers it.** No geolocation, no `Accept-Language`, no address: it is
something a player says about themselves, and a guest may say it too, because a
guest plays here like anybody else and the flag belongs to the seat.

`PATCH /api/me` is the only way to set it. It says the state it wants rather
than asking for a toggle, so `null` clears the flag and two tabs cannot flip
each other, and it answers with the whole of `/api/me` so the client replaces
what it holds instead of patching its own copy. `readCountry` in `countries.ts`
is what a body is read through: it lowercases, treats an empty string as a
clear, and returns `undefined` for anything that is not on the list, which the
route turns into a 400 rather than storing a code that would never draw.

**`countries.ts` is generated and duplicated on purpose.** It holds the codes;
`../../client/src/ui/countries.ts` holds the same codes with their English
names. Both are written by `../../client/scripts/flags.mjs` beside the flag
artwork, so they cannot disagree unless one is hand-edited, and
`../test/country.test.ts` imports both and fails if they do. The alternative was
249 country names on the wire in `@opentable/protocol`, which is a table only
the client prints.

The flag travels with the name wherever a name goes out: `SeatView` (snapshotted
into `matches.seats` when the match is created, like the name and the rating, so
a stored match says what the table looked like), the leaderboard, `/api/recent`,
`/api/live`, arena standings, home game seats, and every `UserSummary`, which is
what carries it onto a profile and a challenge page. Every one of those fields
is optional; see `../../packages/protocol/CLAUDE.md` for which are omitted and
which are sent as null, and why.

## Modes, speeds and formats

Two modes and two speeds, each rated or casual, so **eight** independent
queues. `formatFor(mode, rated, speed)` in the protocol builds the
`MatchFormat`; **the server never invents one.** Six-max is the main game and
`DEFAULT_MODE`: six seats, `hands: null`, blinds climbing so it always ends.
Heads-up is two seats, best of 25 or bust.

**Speed is a real third dimension of the queue and not a tag on a shared
one.** `bucketKey(mode, rated, speed)` is what keeps the eight apart. It is
*not* a dimension of the rating: there is one Glicko-2 pool per mode and the
speed rides along, because four pools need four populations. Splitting them is
a decision for when there is a crowd.

A schedule climbs on two bases and takes whichever is further along
(`levelAt`): hands, which is what six-max has always used, and elapsed match
time, which is what a fast table uses and what keeps a standard one inside two
hours. `levelHands: 0` means no hand basis at all. Every hand asks
`blindsAt(format, handNumber, elapsedMs)` and `TableView.blinds` reports the
answer, with `TableView.level` beside it, which is the only place the client
should read either from: a fast table's level is a function of a wall clock
only the room knows.

**A hand records the blinds it was dealt at** (`hands.sb`, `hands.bb`) for the
same reason. Read them through `handBlinds(hand, format)` in `db.ts`, never off
the row and never by recomputing: a row written before the column existed has
none, and every one of those belongs to a format whose level is a function of
the hand number, which is exactly what the fallback recomputes.

## The ranked gate

Rated play opens after **one finished unrated match**: casual, practice or a
casual home game, counted by `countUnratedFinished` and asked by
`rankedUnlocked` in `matchmaking.ts`. Two doors ask it, `enqueue` when the
search is rated and `joinArena` because an arena is rated heads-up. A refusal
is an `err` with `c: 'ranked_locked'` carrying the sentence the client prints;
`/api/me` sends `rankedUnlocked` so the picker can disable the control rather
than let somebody press a button that answers no.

Challenge links and home games are **not** gated. Those are two people who
have arranged a game, and the point of the gate is a first hand against a
stranger.

## Walkouts and ranked bans

`walkouts.ts` owns them, and is `ready.ts`'s opposite number in every way but
one. A **walkout** is a ranked match ended early by the player it was ended
for: `resign` from the table's leave control, or the heads-up forfeit the
clock takes after three timeouts, which is also where a connection that never
came back lands (`handleGraceExpiry` becomes a clock expiry). Casual and
practice are never walkouts and a bot is never charged one.

The one difference from the ready check is **where the state lives**. A
no-show cooldown is in memory on the argument that a penalty nobody could see
the reason for should not survive a deploy. A walkout is the other case: the
opponent lost their game over it, so it is columns on `users`
(`walkout_strikes`, `walkout_at`, `ranked_ban_until`).

Strikes decay at one a day and **nothing sweeps them**. The count and the
moment it was written are stored together and `walkoutStrikesNow` subtracts a
strike per whole day on read, which is the answer a nightly job would reach
without a nightly job existing. `chargeWalkout` lands the new strike on the
decayed count, so three walkouts last week and one today is one strike.

The ladder (`WALKOUT_BAN_MS` in the protocol, by the strike count *after* this
walkout) is 1 free, 2 five minutes, 3 thirty minutes, 4 two hours, 5 or more
eight hours. It is in the protocol and not here because the modal that warns
what leaving will cost has to name the number the ban will be, and two copies
of the table drift until the warning starts lying. A ban already running is
never shortened by a fresh walkout.

**Four ranked doors ask about a ban**, and unlike the gate above that includes
the two arranged games, because the ban is about a match somebody walked out
of rather than about playing a stranger:

| Door | Where | Refusal |
| --- | --- | --- |
| the rated queue | `enqueue` | `err` with `c: 'ranked_ban'` |
| an arena | `joinArena` | 409 |
| a rated challenge link | `acceptChallenge`, **both seats** | 409 |
| a rated home game | `startHomeGame` | 409 |

The challenge asks about the creator as well as the person accepting: a banned
player who sent the link would otherwise be dealt into a rated match by
somebody else pressing the button. The home game asks in `startHomeGame`
*after* it has worked out whether the table is rated at all, not at its door,
because a table that drops to casual for want of a second human is not a
ranked door and nobody should be kept out of it.

`/api/me` carries `walkoutStrikes` and `rankedBanUntil` (epoch ms, null when
none is running) so the play panel can disable ranked and say why, the same
bargain `rankedUnlocked` makes. The sentence both the refusals and the panel
use is `rankedBanText`, one function, because two wordings read as two rules.

## The ready check

`ready.ts` owns it, and owns nothing about where the players came from: the
caller hands it the humans, a `start` closure that deals the table and an
`onCancel` that says what to do with the wreckage. Two callers today. The
queue's `launch` opens one for every gathered table, charges a cooldown to
whoever failed it and puts everybody else back with their **original
`joinedAt`**, which is what "the front of the queue" means here, since both
pairing functions order by how long somebody has waited. The arena's `start`
opens a shorter one (10s rather than 20s) and answers a no-show by **pausing**
them in the arena, because there is no queue there to go back to.

Three things worth knowing:

- **The bots are picked inside `start`, not before the check.** Twenty seconds
  is long enough for another table to take them, and a table that starts with
  a bot already in a match is a table with an empty chair. The arena is the
  exception and picks first, because it caps its own bot count.
- **A disconnect is not a decline.** `dequeueOnDisconnect` leaves a pending
  check alone so somebody who reconnects inside the window can still accept;
  an explicit `dequeue` *is* a decline, because pressing cancel while five
  people wait on you is not "I stopped searching".
- **Nothing is persisted.** A restart drops every check and every cooldown,
  the same bargain the queue makes.

Practice never opens one: it builds its table on the spot and there is nobody
to wait for.

## The REST surface

Shapes are mirrored by `client/src/net/types.ts`. Five rules are worth knowing
that the shapes themselves do not say:

- **The flat `rating`, `rd`, `provisional`, `peak`, `peakAt`, `matches`, `wins`,
  `losses` and `draws` are the heads-up values**, kept for compatibility beside
  the mode-keyed `summary.ratings` map. Every flat field is read straight off the
  heads-up standing rather than recomputed beside it, so a client that falls back
  from a null per-mode value to the flat one can never be handed a different
  answer.
- **An unrecognised `?mode=` falls back rather than erroring**, on
  `/api/leaderboard` and on `/api/users/:name/insights` alike.
- **`/api/hands/:id` reports the hand's own `sb` and `bb` from `blindsAt`**, not
  the format's level-1 blinds, which is what a replay needs to rebuild the engine
  config. It also carries `liveSeats` (`match/CLAUDE.md`).
- **`/api/matches/:id`'s per-hand `accuracy` is one entry per table seat**, null
  throughout for six-max, which stores no study.
- **`/api/puzzles/hand` does the walk here, not in the client.** It returns one
  random finished, non-practice, heads-up hand whose action log holds a spot the
  charts have an answer for, with the seat to grade and the index of that action.
  The random pick and the "has a gradeable spot" filter happen in one query
  rather than the client fetching hands until one fits; the client replays the
  log to that index itself. 404 while no such hand exists.

### Percentiles and the main mode

`/api/users/:name` also answers "where does this put me", which is the only
reading of a rating that needs no scale beside it. Two additive fields:

- **`percentiles`**, one entry per mode. `rank` is the 1-based place counting
  from the top, `population` is the field that place is in, and `percentile` is
  the share of that field rated **strictly below** this player, to one decimal.
  The best of five reads 80.0, not 100. A mode with no rated match behind it,
  and every mode of a bot, is `null` rather than a rank in a field they are not
  in.
- **`main`**, the mode with the most rated matches, the higher rating breaking
  a tie and heads-up when they have played neither (`userView.mainMode`). It
  answers "where do you play", not "where are you best": two hundred heads-up
  matches make somebody a heads-up player on a day their six-max rating happens
  to read higher. The profile opens its headline, its rating line and its
  insights on it.

**The population is every non-bot with at least one rated match in the mode**
(`getModeStandings` in `db.ts`, one window query). Bots are excluded because
they hold ratings the ladder keeps moving, so counting them would make a
person's place depend on how many robots the box happens to run; rows with no
rated match behind them are excluded because a default 1500 nobody earned would
stack a crowd of ghosts in the middle of the board. Unlike `/api/leaderboard`
this does **not** drop provisional players: somebody four matches in is still
somebody you are ahead of, and dropping them would shrink the field as the site
got busier. Ranks are `rank()`, not `row_number()`, so a tie shares a place, and
ranking from the bottom gives the strictly-below count for free.

**`stats.vpip`, `stats.pfr`, `stats.aggressionFrequency` and `stats.foldTo3bet`
on `/api/users/:name` are no longer read by anything.** The profile printed them
as a play-style block over the player's whole history; the insights route gives
the same four rates per mode, and one page carrying both meant two different
numbers under one label. The block is gone and these four are removable after a
deploy cycle, along with the matching fields on `getUserHandStats`'s aggregate.
`stats.hands` stays: the profile still prints how many hands the preflop accuracy
was averaged over.

## Matchmaking

One in-memory `Map<userId, QueuedPlayer>`. Nothing here is persisted, so a server
restart drops the queue, which is acceptable because clients just re-send
`queue`. Each entry carries its own `mode`, `rated` and `speed`, and the tick
buckets them by all three, which is what makes the eight queues independent
without eight maps. `enqueue` widens the user's RD for inactivity via `widenRd` before adding
them (the rating row for the mode being queued for, not their heads-up one) and
immediately replies `q searching` with the mode, the rated flag, the current
`window()` range and, for a multiway table, `seated`.

A 1s `setInterval` walks each bucket. Heads-up pairs humans with `pairQueue`;
six-max gathers with `groupQueue(entries, 6, now)`, where the longest waiter
anchors a group and pulls in the closest-rated entries that sit inside its window
and each other's. **An anchor that cannot fill a whole table is left in the queue
rather than half-consumed.** Both pairing functions are `@opentable/rating`'s, so
the arithmetic is pure and tested there.

A gathered table is **offered before it is created**: `launch` takes everybody
out of the queue and opens a ready check, and only an accepted one reaches
`createMatchForPlayers`. That allocates a short id (base32-ish, retried on the
rare collision), inserts `matches` and `match_players`, builds a `MatchRoom`,
registers it, and sends `q found` to every seat. **Seat order is shuffled**, so
a human is not always on the first button.

### Bot fill

Two constants at the top of the file, both measured from the longest wait in that
queue: `BOT_FILL_HEADS_UP_MS` (5s) and `BOT_FILL_SIX_MAX_MS` (20s). Heads-up
gives a lone human one bot. Six-max launches on six humans, or after the
threshold with bots in the remaining seats, ranked included. Ranked used to be
people or nothing (five bots at a rated table is a rating anybody could dial
in), but with one person on the site that meant ranked six-max never dealt;
until the bot population plays the queue as ordinary opponents, a rated bot
fill is the same bargain the rated heads-up fill already makes. **Bots never fill a
table with no human**, and a roster too short to fill the table waits rather than seating a
short-handed one. Candidates come from `availableBots(rating, n)` in `bots/`:
loaded in this process, not in a live match (a finished room lingers a minute, so
this asks `room.active`, not whether the room exists), closest in rating first.

Practice mode is a `queue` message carrying `bots: {level}`. It skips the human
queue entirely through `enqueuePractice`, builds the table on the spot from bots
at that level and outwards, and is always unrated.

## Challenges and home games

Two files rather than one mode of the same file, for a reason: **two people can
be seated by the second one accepting, six cannot.**

`challenges.ts` writes a `challenges` row, capped at five open per player and
alive 24 hours. Accepting claims the row with a conditional UPDATE, so two people
opening the same link cannot both be seated, and then calls
`createMatchForPlayers`, which announces the table to both sides with the ordinary
`q found`. Heads-up only.

`home-games.ts` is a **lobby** with a host who says when it starts. Creating one
writes a `home_games` row (capped at three open per host, alive 24 hours) and
seats the host in `home_game_seats`, so the seat table is the whole guest list and
`host_id` only says whose table it is. **The capacity test lives inside the
seating insert**, so six people opening the link at the same moment cannot all sit
at a table with six chairs. Starting claims the row with a conditional UPDATE (a
host double-clicking cannot open two tables), fills the empty seats with
`availableBotsAtLevel` and calls the same `createMatchForPlayers`, so every seat
is told by the ordinary `q found`. Everyone seated is pushed a `lobby` message on
every seat or status change; a page whose socket is not open falls back to asking
again every five seconds.

**A home game is rated only with two humans in it.** One person and five bots of
a strength they chose is a rating that could be dialled in, so the match is forced
casual and the response says which choice was overridden rather than changing it
quietly. `format.homeGame` marks it for the feed's badge.

On both, `expired` is derived from `expires_at` at read time and never written,
so neither table needs a sweeper.

## Arenas

An event on every hour, half an hour long, heads-up and rated. Join and you are
paired again the moment your match ends. Nothing about it needs an admin: the
scheduler keeps the current arena plus three ahead in the `arenas` table, opens
each one when its clock starts and closes it when its clock runs out.

**An arena match is an ordinary rated heads-up match.** `format.arena` carries the
arena's id and is the only thing that makes it one: the same
`createMatchForPlayers`, the same Glicko-2, the same public page, the same feed
row badged "Arena".

**Pairing** runs once every two seconds. Everyone pairable is ordered by score,
then wins, then rating, which is the order `getArenaPlayers` already returns, and
neighbours in that order are paired: closest score, rating breaking the tie.
Whoever is left over waits, and after `BOT_FILL_MS` (8s) with nobody to meet gets
a bot at the nearest rating. Never two bots at an arena table, and at most
`MAX_ARENA_BOTS` (6) bots in arena matches at once, because a roster of fifteen
that an arena could take all of would starve the ladder that gives the bots their
ratings.

**Pairable** is three things: not paused, not already at a live table, and
connected. The socket is what stands in for presence and the pause toggle is what
stands in for choice. There is no page-scoped heartbeat, so a tab left open in
the background is still here. That is the same bargain the queue makes, and it is
why `pause` exists at all.

**Scoring is the one running total on this site.** `arenaPoints` in the protocol
is the table (2 for a win, 1 for a draw, 0 for a loss, 3 for a win with two
already banked) and it lives there rather than here because the client draws the
flame that promises the next win is worth three. The counters are on
`arena_players` rather than derived from the matches, unlike everything else here:
the streak bonus makes each result depend on the ones before it, so a board
rebuilt from the matches would have to replay them in order anyway. A bot opponent
counts exactly like a person.

**The end.** Pairing stops `LAST_PAIRING_BEFORE_END_MS` (3 min) before the clock
runs out, and a match that started before then is played out and scored: that is
the Lichess bargain, and freezing the board while one was still live would throw
away a result somebody earned. The arena closes on the first tick after its clock
has run out **and** no arena match is still live, which writes every place onto
`arena_players` and the top three onto `arenas.podium` in one transaction. Nothing
scores after that: `scoreMatch` refuses an arena that is not `running`, which is
the freeze.

**Live updates.** A page says which arena it is looking at (`{t:'arena', a}`,
`null` to stop) and gets standings, its own row, the status, the end time and
what is playing back: on a five second beat while running, and at once on any
score or status change. The subscription is dropped on disconnect, so the client
re-sends it on every reconnect rather than only on mount. A page whose socket
never opened polls `GET /api/arenas/:id` instead.

How a finished match reaches the scoreboard at all is `match/finished.ts`, in
`match/CLAUDE.md`.

## Insights

`/api/users/:name/insights` is the one route that derives its answer from the
hand histories instead of reading a counter the write path kept. Every hand the
player was dealt into is replayed through `@opentable/engine`, which is what gives
each logged action the street it was taken on, each seat its total commitment and
the hand its outcome. **Nothing re-implements the betting rules**: a change to
them lands here for free rather than leaving a second, quietly wrong model of
poker in the server.

The stored log is in table seats and the engine speaks engine seats, so
`liveSeats` is applied on the way in exactly as the hand runner applies it on the
way out. A hand the player was not dealt into (they had already busted, which in
six-max is most of the rows a match contributes) drops out at that step, and so
does a log that no longer replays, rather than being counted as a hand with
nothing in it.

Two rules shape the payload. **Below `MIN_INSIGHT_HANDS` (20) every derived group
is null** and only `sample` is filled in: twelve hands of poker say nothing about
anybody, and a number on the screen is a claim. And **a rate with no denominator
is null, not zero**: no flops seen is not a 0% showdown rate, never having been
the preflop raiser is not a 0% c-bet. The client prints what was missing instead.

The answer is memoised per (user, mode) on the id of that player's latest finished
match in that mode: nothing in it can move until another of their matches ends.
The cheap query is the one that produces the key, so a cache hit costs a single
lookup and a new match invalidates without a timer. That is a server-side memo,
not an HTTP cache: the response still carries `Cache-Control: no-store` like
everything else under `/api`. `getInsightHandsForUser` is bounded
(`INSIGHT_HAND_LIMIT`, 3000 hands, newest first) because this runs on a request
path. Three thousand hands replay in about half a second, which is a cache miss
nobody notices and a hot loop nobody should write.

## Explorer

Every finished hand of a mode replayed into one cube of (position, facing, hand
class) tallies that `sliceExplorer` reads a selection out of. **The cube is added
to rather than rebuilt**, and the route tops it up once a minute, because
replaying the whole corpus every time a match finished would block the event loop
for the best part of a second.

It is also **the one route that overrides `app.ts`'s blanket `no-store` on
`/api`**: it is the same public aggregate for everybody, so it is cacheable.

## meta.ts

What a pasted link shows. The built shell (`client/index.html` as compiled into
`CLIENT_DIST`) is read once at boot, with a
per-request `<title>`, description, Open Graph and Twitter card tags injected for
matches, hands, profiles, challenges, home games and the static pages, plus
`/robots.txt` and `/sitemap.xml`.

**The shell is deliberately excluded from `@fastify/static`** (`globIgnore` in
`app.ts`), so `/` and every client route reach the shell through the not-found
handler and nothing can serve the generic head. Per-id lookups are cached 10s and
any miss or failure falls back to the plain shell with a 200. The mark and the
card image it points at are client assets (`client/public`).

## The ladder

`ladder.ts` is the one bot-only table there is: bots play each other, rated, one
match at a time, and only while nobody is queued or playing. The point is that
the levels spread out on their own, so the practice picker's per-level average is
a number somebody earned rather than fifteen bots all reading 1500. Off under
vitest, with `LADDER_ENABLED` and `LADDER_PAUSE_MS` on the box. Ladder matches are
kept off `/api/live` and off `/api/recent` unless `?ladder=1`: nobody played them,
but they are stored and replayable like any other match.
