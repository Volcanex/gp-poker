# packages/protocol

The wire types and the per-viewer `TableView`. The contract between server and
client, and nothing else: no logic, no I/O, no dependencies.

## Versioning

`PROTOCOL_VERSION` is the number, and it is the number to read rather than any
prose about it. Every change to a shape in `src/index.ts` bumps it, and the
server keeps accepting the previous one for a deploy cycle.

**Every addition is optional.** A new field arrives as `field?: T` with a doc
comment, so a client built against the previous version parses the new payload
unchanged and simply does not draw the thing it has never heard of. Nothing is
renamed and nothing changes type: those are not additions, and a client in a
tab somebody left open last week is still talking to this server.

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
them down), and `arenaPoints` with `ARENA_FIRE_FROM` (the server scores, the
client draws the flame promising the next win is worth three).

What does **not** live here is anything only one side needs. The 249 country
names behind a flag are the example: the codes are validated in
`../../server/src/countries.ts` and named in `../../client/src/ui/countries.ts`,
two generated lists a server test holds to each other, because a wire contract
has no business carrying a table of English place names.
