# packages/rating

Glicko-2 rating and pure matchmaking pairing, no state of its own.

## Glicko-2
Lifetime rating, no seasonal reset: every match is its own rating period,
so `updateRating` is called with zero results (idle widening) or exactly
one opponent result, never a batch. `tau` defaults to 0.75 (the paper
suggests 0.3-1.2; higher trusts single results more, which suits a format
where players rarely play many matches per day). Volatility iteration uses
the paper's Illinois algorithm with epsilon 0.000001, verified against the
paper's own worked example (1500/200/0.06 vs three opponents, tau 0.5 ->
1464.06/151.52/0.05999).

RD is floored at 30 (so ratings never freeze) and capped at 350 (the
starting RD). `isProvisional` is `rd > 110`, the paper's usual "has played
enough" threshold.

## RD widening on inactivity
`widenRd` grows RD as `sqrt(rd^2 + c^2 * days)`. `RD_WIDEN_C` is derived,
not guessed: it's the constant such that a fully settled player (rd 50)
drifts back up to the 350 cap after exactly 730 days idle, i.e.
`c = sqrt((350^2 - 50^2) / 730)`. The server is expected to call this once
per elapsed day since a player's last match, before feeding them into
matchmaking or displaying their rating.

## Matchmaking
`pairQueue` is pure and stateless; the server ticks it once a second
against its live queue and applies whatever pairs come back. Both it and
`groupQueue` take an optional `reach` in place of `window`; `anyone` is the
one that ignores rating altogether, which is what the server uses for its
people-only pass. `window(entry,
now)` is `max(100, 2*rd) + 30` per second waited, capped at 1000, and
unbounded (`Infinity`) once an entry has waited 30 seconds or more, so
nobody queues forever. It widens every second rather than in five-second
jumps so the range a searching player is shown actually moves as they
watch it. A pair only forms when the rating gap sits inside *both* entries'
windows. Entries are processed longest-waiting-first, each picking its
closest-rated eligible opponent; ties break by `joinedAt` then `id` so the
result is deterministic for identical inputs.

This window is what governs when a human accepts a **bot already sitting in
the queue** as an opponent (population bots search the same queue as
ordinary entries, `server/src/matchmaking.ts`'s `CLAUDE.md`). It has nothing
to do with human-to-human pairing, which the server runs first and
unrestricted (`anyone`) regardless of this curve: on a site this size two
real people are matched the instant both are searching, whatever the rating
gap, and `window` only decides how patient a lone search is about a bot
before that.
