# protocol

The wire types and the per-viewer `TableView`: the contract between the server
and the client, and nothing else. Pure types plus the few constants both sides
have to agree on (`formatFor`, `blindsAt`, `BOT_LEVELS`, `arenaPoints`, the chat
limits), because two copies of a number drift until one of them starts lying.

## Versioning

`PROTOCOL_VERSION` is the number, and it is read off that constant rather than
out of a document. Bump it for a change that an older client cannot be served,
and keep the server accepting the previous one for a deploy cycle.

**Additive fields do not bump it.** A field marked optional that an old client
simply never reads is not a break, and calling it one costs a deploy cycle of
compatibility code for nothing. v4 gained the `arena` message in both directions
and `format.arena` that way, and it gained profile pictures the same way.

**v5 is the first version that had to bump.** Speed would have been additive on
its own: `format.speed`, `format.levelSeconds` and `TableView.level` are all
optional and all default to what a v4 format already meant. The ready check is
what makes it a break. A matchmade table now waits for every human at it to
send `{t:'ready', a:true}`, and a v4 client neither draws the prompt nor knows
the message: it would sit through the countdown, be dropped as a no-show and
collect a cooldown for it. A client that cannot answer a question the server is
about to ask is not a client that can be served unchanged.

## Speed and the schedules

`Speed` is `short` or `long`, and the four formats are spelled out in full with
the arithmetic for each written above it: how many big blinds the table holds
at each level, when that level begins, and why the top one ends the table. The
promise those tables keep is `matchCeilingMs(format) <= ceilingFor(speed)`,
twenty minutes for short and two hours for long, and `server/test/speed.test.ts`
is what holds them to it rather than a comment claiming they do.

The mechanism is the same for both: at the top level the big blind is at least
half the chips in play, so no seat can post one without being all-in and each
hand from there busts somebody. The ceiling is therefore the moment the top
level begins plus `players - 1` forced hands, which is what `matchCeilingMs`
computes. **Nothing stops a hand on a timer**: a hand cut off halfway is not a
poker result.

`speedOf(format)` is where `long` is spelled as the default for a stored format
that has no `speed`, so nothing else has to remember it. `levelAt` is where the
two bases meet.

## Level and badges

`levelFor`, `levelThreshold`, `levelProgress`, `BADGES` and `badgesFor` are
here for the reason everything else here is: the server tests the curve, the
profile draws it and the top bar prints it, and three copies of "level 5 is
fifteen matches" would drift. They are pure functions of counters that already
exist, so nothing is written when a level or a badge is earned, and neither can
be out of date.

**Neither unlocks anything.** The one gate on this site is
`RANKED_GATE_MATCHES`, which is a different thing entirely: one finished casual
or practice match before rated play opens.

## `avatarV`

Optional on every shape that names somebody: `UserSummary`, `SeatView`,
`LobbySeat`, `ArenaStanding` and `ChatFrom`. It is the version of that player's
uploaded picture, and the client asks for `/api/avatars/<id>?v=N` with it.

Three states, two of which read the same:

| Value | Means |
| --- | --- |
| absent | a server from before pictures existed |
| `0` | this player has no picture |
| `> 0` | ask for that version |

Absent and zero both mean "draw the generated avatar", which is why nothing
reads the field directly: `avatarVersion()` in `client/src/net/adapt.ts` is the
one place that collapses them.

The version goes up on every change **including a removal**, which is what lets
the picture URL be served immutable: a new picture is a different URL rather than
a cache to invalidate. `server/src/CLAUDE.md` has the storage and the routes.

`SeatView.avatarV` is frozen when the match was created, like the name and the
rating beside it, because it is stored with the seat in the match row.

## Omitted or null

An optional field is either **omitted** or **sent as null**, and which one is a
decision worth writing down at the field:

- **Omitted** is the default. `SeatView.country`, `LobbySeat.country` and
  `ArenaStanding.country` are left off when the player has no flag, because a
  seat goes out on every action and most players will never set one.
- **Sent as null** is for a payload the client merges over one it already
  holds. `UserSummary.country` is sent even when it is null, because a summary
  replaces the fields it names and a key that vanished when a flag was cleared
  would leave the old flag on the screen.

`botLevel` is the other shape of the same choice: present only on a bot, absent
on a person rather than null, because it is a fact about what the row is rather
than a value that can be cleared.

## What lives here rather than on one side

Anything both sides have to agree a number for, so two copies of it cannot
drift: `HAND_HOLD_MS` and `holdFor` (the server sleeps it, the client counts it
down), `BOT_LEVELS` (the server plays them, the client offers them),
`CHAT_MAX_LENGTH` and the cooldowns (the server enforces them, the client counts
them down), `arenaPoints` with `ARENA_FIRE_FROM` (the server scores, the
client draws the flame promising the next win is worth three), `READY_CHECK_MS`
and `readyCooldownMs` (the server runs the window and sets the wait, the client
counts both down), and the level curve (the server tests it, the profile and
the top bar print it).

What does **not** live here is anything only one side needs. The 249 country
names behind a flag are the example: the codes are validated in
`../../server/src/countries.ts` and named in `../../client/src/ui/countries.ts`,
two generated lists a server test holds to each other, because a wire contract
has no business carrying a table of English place names.
