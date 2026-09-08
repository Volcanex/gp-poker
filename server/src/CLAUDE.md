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
| `matchmaking.ts` | the in-memory queues, their tick, and match creation |
| `challenges.ts` | play a friend: a link instead of a queue |
| `home-games.ts` | the six-max version of that link, as a lobby |
| `arena.ts` | the hourly competitive event |
| `ladder.ts` | bots playing each other so their ratings spread out |
| `chat.ts` | the pure half of table chat: `cleanChatText` and `ChatLimiter` |
| `insights.ts` | the pure derivation behind `/api/users/:name/insights` |
| `explorer.ts` | the pure derivation behind `/api/explorer` |
| `meta.ts` | what a pasted link shows, plus `/robots.txt` and `/sitemap.xml` |
| `health.ts` | `/health`, five checks (see the repo root `CLAUDE.md`) |
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

## Modes and formats

Two modes, each rated or casual, so four independent queues. `formatFor(mode,
rated)` in the protocol builds the `MatchFormat`; **the server never invents
one.** Heads-up is two seats, 200 units, flat 1/2 blinds, 25 hands or bust.
Six-max is a sit-and-go: six seats, `hands: null`, and a nine-level blind
schedule (`levels`, `levelHands: 8`) so it always ends. Every hand asks
`blindsAt(format, handNumber)` for its level and `TableView.blinds` reports it,
which is the only place the client should read the current blinds from.

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
`queue`. Each entry carries its own `mode` and `rated`, and the tick buckets them
by `(mode, rated)`, which is what makes the four queues independent without four
maps. `enqueue` widens the user's RD for inactivity via `widenRd` before adding
them (the rating row for the mode being queued for, not their heads-up one) and
immediately replies `q searching` with the mode, the rated flag, the current
`window()` range and, for a multiway table, `seated`.

A 1s `setInterval` walks each bucket. Heads-up pairs humans with `pairQueue`;
six-max gathers with `groupQueue(entries, 6, now)`, where the longest waiter
anchors a group and pulls in the closest-rated entries that sit inside its window
and each other's. **An anchor that cannot fill a whole table is left in the queue
rather than half-consumed.** Both pairing functions are `@opentable/rating`'s, so
the arithmetic is pure and tested there.

Creating the match allocates a short id (base32-ish, retried on the rare
collision), inserts `matches` and `match_players`, builds a `MatchRoom`,
registers it, and sends `q found` to every seat. **Seat order is shuffled**, so a
human is not always on the first button.

### Bot fill

Two constants at the top of the file, both measured from the longest wait in that
queue: `BOT_FILL_HEADS_UP_MS` (5s) and `BOT_FILL_SIX_MAX_MS` (20s). Heads-up
gives a lone human one bot. Six-max launches on six humans, or after the
threshold with bots in the remaining seats. **Bots never fill a table with no
human**, and a roster too short to fill the table waits rather than seating a
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
