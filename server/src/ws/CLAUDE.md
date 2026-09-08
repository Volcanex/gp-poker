# ws

The websocket layer, split so that nothing here has to know about poker.

- `hub.ts`: the connection registry and the raw per-socket protocol handling
  (decode, `hi`, ping and pong, the audit log). It knows nothing about
  matchmaking or match rooms; dispatch is injected.
- `router.ts`: routes `queue`, `dequeue`, `join`, `leave`, `act`, `next`, `chat`
  and the arena subscription to matchmaking and match rooms. It is the one
  place that imports both.

The upgrade itself is authenticated in `../app.ts`. `/ws`'s `preValidation` hook
uses `resolveSessionUser` and **does not mint a guest**: it rejects with 401 if
there is no valid session, since the client always calls `/api/me` first to get
one (`../auth.ts`).

## Virtual connections

A bot has no socket. It registers a virtual connection with the hub
(`hub.attachVirtual`), and `hub.send` routes to that handler **before** it looks
for websockets, so rooms, the clock and persistence never learn the difference.
`hub.isConnected` counts it too, and since nothing ever closes, a bot is
`connected: true` for the life of the match.

Messages go back out through `routeClientMessage`, the same path a socket action
takes. It is injected into `../bots/` via `setBotDispatch` from `../app.ts`, so
`../bots/` never imports the websocket layer that imports matchmaking. See
`../bots/CLAUDE.md`.

## Disconnects

`routeDisconnect` is the one entry point for a socket going away. It dequeues
them, drops any arena subscription, hands the player's own room a disconnect
(which freezes their clock and starts the grace timer, see `../match/CLAUDE.md`),
and drops every table that user was spectating. A spectator's subscription does
not survive a disconnect the way a seated player's does, which is what stops the
subscriber set growing forever. `routeConnect` is the mirror, and only has a
reconnect to deliver.
