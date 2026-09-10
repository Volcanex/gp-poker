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

**v6 is friends**, and it is the one bump made on an argument rather than on a
break. The two new pushes (`friend` and `invite`) and `challenges.speed`
reaching `Challenge` are all additive by the rule above: a v5 client never
subscribed to either message and never reads the field. The number moves
anyway, because a client that cannot draw an invite leaves its player sent to a
table nobody told them about, which is the same argument the ready check made.
`FriendEvent` deliberately carries nothing beyond its kind: the page asks
`/api/friends` again, so there is never a second shape of the list on the wire.
**v7 is tournaments, and it did not have to bump.** `format.tournament`, the
`tournament` message in both directions and the shapes behind it are all new,
and a v5 client that never sends one is served exactly as it was. The number
moved anyway because this repo's convention is that a change to this package
bumps it, which is cheaper than arguing about which changes are additive at the
moment somebody is making one. Nothing reads the number to refuse a client: the
server sends it in `hi` and that is all.

What lives here for tournaments is what both sides have to agree a meaning for:
`TournamentShape` and `TournamentStatus`, `TOURNAMENT_MIN_FIELD` (the
registration card says how many are still needed), the shootout's table size and
floor, and the board the live subscription pushes. What does **not** live here is
the calendar: the names, the seat caps and the schedule are server-side data
(`server/src/tournaments/fixtures.ts`) and travel on the payload, so the client
never holds a second copy of a fixture's name.

**Sitting out was additive inside v5.** `SeatView.sittingOut` is optional and
absent rather than false, so an old client reads a seat it already understands.
`ClientMsg.back` is the harder half of the pair, because a message an old
server does not know is answered with `bad_msg` rather than ignored, and that
looks like a break in the other direction. It is not one: the only thing that
makes a client send `back` is a seat that says `sittingOut`, and a server old
enough not to know the message is a server that never sets the field.

## Speed and the schedules

`Speed` is `fast` or `standard`, and the four formats are spelled out in full with
the arithmetic for each written above it: how many big blinds the table holds
at each level, when that level begins, and why the top one ends the table. The
promise those tables keep is `matchCeilingMs(format) <= ceilingFor(speed)`,
twenty minutes for fast and two hours for standard, and `server/test/speed.test.ts`
is what holds them to it rather than a comment claiming they do.

The mechanism is the same for both: at the top level the big blind is at least
half the chips in play, so no seat can post one without being all-in and each
hand from there busts somebody. The ceiling is therefore the moment the top
level begins plus `players - 1` forced hands, which is what `matchCeilingMs`
computes. **Nothing stops a hand on a timer**: a hand cut off halfway is not a
poker result.

`speedOf(format)` is where `standard` is spelled as the default for a stored format
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

`TableView.hold` is the same shape again: present as `'you'` only in the one
state it describes (a practice table holding a finished hand for the human),
absent for everyone and everything else rather than a boolean that is usually
false. `ClientMsg`'s `next` answers it, the way `ready` answers the ready
check: sent without needing to ask what state the table thinks it is in,
because the server already knows and ignores anything that does not match.

## What lives here rather than on one side

Anything both sides have to agree a number for, so two copies of it cannot
drift: `HAND_HOLD_MS` and `holdFor` (the server sleeps it, the client counts it
down), `BOT_LEVELS` (the server plays them, the client offers them),
`PRACTICE_PRESETS` (the home page's Easy/Medium/Hard buttons and the `/bots`
setup page both read the same level for each name, so a rename or the level 6
bot landing cannot move one without the other), `CHAT_MAX_LENGTH` and the
cooldowns (the server enforces them, the client counts them down),
`arenaPoints` with `ARENA_FIRE_FROM` (the server scores, the client draws the
flame promising the next win is worth three), `READY_CHECK_MS` and
`readyCooldownMs` (the server runs the window and sets the wait, the client
counts both down), and the level curve (the server tests it, the profile and
the top bar print it).

What does **not** live here is anything only one side needs. The 249 country
names behind a flag are the example: the codes are validated in
`../../server/src/countries.ts` and named in `../../client/src/ui/countries.ts`,
two generated lists a server test holds to each other, because a wire contract
has no business carrying a table of English place names.

## Bot levels and tiers

**A tier is what a bot plays; a level is only where that tier currently sits on
the ladder.** `BotTier` names the seven strategies and `LEVEL_TIER` says which
level each one is at. Nothing anywhere may branch on the number: the server's
strategy dispatch, the roster, the budget table and the practice picker all
read the tier, so renumbering the ladder is an edit to `LEVEL_TIER` and not a
search for integer comparisons.

`LEVEL_TIER` is one-to-one, and has to be. Two levels sharing a tier is two
levels playing identically, which `../../server/src/bots/levels.test.ts` would
fail, and it would fail for the right reason.

`BOT_LEVELS` is the one table the server (which plays them) and the client
(which offers them in the practice picker) share, so a level's name,
description and tier cannot drift between the two. Levels are appended the same
way the roster grows: `isBotLevel` reads its bound off the table's length
rather than a literal, and `botLevelInfo` still answers with the default for
anything outside it, because a stored or hand typed level is a preference and
must not break a table. Adding one is additive by the rule above, so it does
not move `PROTOCOL_VERSION`.
