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
against its live queue and applies whatever pairs come back. `window(entry,
now)` is `max(100, 2*rd) + 50` per 5 seconds waited, capped at 1000, and
unbounded (`Infinity`) once an entry has waited 60 seconds or more, so
nobody queues forever. A pair only forms when the rating gap sits inside
*both* entries' windows. Entries are processed longest-waiting-first, each
picking its closest-rated eligible opponent; ties break by `joinedAt` then
`id` so the result is deterministic for identical inputs.
