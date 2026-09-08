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
