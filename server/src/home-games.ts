import type { HomeGameStatus, LobbySeat, MatchFormat, UserSummary } from '@opentable/protocol';
import { botLevelInfo, isBotLevel, DEFAULT_BOT_LEVEL } from '@opentable/protocol';
import {
  cancelOpenHomeGame,
  claimHomeGame,
  countOpenHomeGames,
  deleteHomeGameSeat,
  getHomeGameById,
  getHomeGameSeats,
  getRatingsFor,
  getRatingsForUsers,
  getUserById,
  insertHomeGame,
  insertHomeGameSeat,
  releaseHomeGame,
  setHomeGameMatch,
  type HomeGameRow,
} from './db.js';
import { createMatchForPlayers, matchFormat, randomMatchId } from './matchmaking.js';
import { availableBotsAtLevel } from './bots/index.js';
import { roomForPlayer } from './match/rooms.js';
import { toUserSummary } from './userView.js';
import { hub } from './ws/hub.js';
import { isUniqueViolation } from './pgError.js';

/* A home game is the six-max version of "play a friend": one private table, one
   link, and a host who decides when it starts. A challenge link seats exactly
   two people and starts itself the moment the second one accepts, which is the
   whole of it heads-up. Six seats cannot work that way: somebody has to gather
   the table and say when it is enough, and whoever made the link is the only
   person who can. So this is a lobby, and the host is the one who starts it.

   Empty seats are filled with bots at a level the host picks, using the same
   nearest-level fallback the practice picker uses, because three bots per level
   is never enough to fill five seats from one level.

   The host holds a seat like everybody else, which is what makes the guest list
   one table rather than a host plus a list. */

export const HOME_GAME_TTL_MS = 24 * 60 * 60 * 1000;

/* Lower than the challenge cap of five: a home game is a table somebody
   gathers, and three of them waiting at once is already more than anyone is
   really running. */
export const MAX_OPEN_HOME_GAMES = 3;

// Six, from the format itself, so a test that shrinks the table shrinks the
// lobby with it rather than seating people the match has no chairs for.
export function homeGameSeats(): number {
  return matchFormat('six-max', true).players;
}

export interface HomeGameView {
  id: string;
  host: UserSummary;
  seats: LobbySeat[];
  players: number; // seats at the table, empty ones included
  rated: boolean;
  botLevel: number;
  status: HomeGameStatus;
  matchId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

type Refusal = { ok: false; status: number; error: string };

const FULL = 'this table is full';

/* The stored status never says expired: a lobby that ran out of time is one
   nobody cancelled and nobody started, and the clock is the only thing that
   changed. Deriving it here is what keeps the table free of rows a sweep would
   have had to correct. */
export function statusOf(row: HomeGameRow, now = Date.now()): HomeGameStatus {
  if (row.status === 'open' && row.expiresAt.getTime() <= now) return 'expired';
  return row.status;
}

async function seatViews(gameId: string, hostId: string): Promise<LobbySeat[]> {
  const rows = await getHomeGameSeats(gameId);
  const standings = await getRatingsForUsers(
    rows.map((r) => r.userId),
    'six-max'
  );
  return rows.map((r) => ({
    uid: r.userId,
    avatarV: r.avatarV,
    name: r.name,
    rating: Math.round(standings.get(r.userId)?.rating ?? 1500),
    host: r.userId === hostId,
  }));
}

/* Everyone seated is told who else is, over the socket they already have open,
   so a lobby fills in front of the people in it rather than on their next poll.
   Anybody who is not connected simply misses it and reads the same answer from
   the page's own request. */
async function pushLobby(row: HomeGameRow, seats?: LobbySeat[]): Promise<void> {
  const list = seats ?? (await seatViews(row.id, row.hostId));
  const status = statusOf(row);
  for (const seat of list) hub.send(seat.uid, { t: 'lobby', g: row.id, seats: list, status });
}

export async function createHomeGame(
  hostId: string,
  rated: boolean,
  botLevel: number
): Promise<{ ok: true; row: HomeGameRow } | Refusal> {
  const open = await countOpenHomeGames(hostId);
  if (open >= MAX_OPEN_HOME_GAMES) {
    return {
      ok: false,
      status: 429,
      error: `you already have ${MAX_OPEN_HOME_GAMES} tables waiting. Cancel one to make another.`,
    };
  }

  // A level outside 1..5 reads as the default rather than erroring, the same
  // way the protocol's own lookup treats one: a level is a preference.
  const level = isBotLevel(botLevel) ? botLevel : DEFAULT_BOT_LEVEL;
  const expiresAt = new Date(Date.now() + HOME_GAME_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await insertHomeGame(randomMatchId(), hostId, rated, level, expiresAt);
      // The host takes a seat on the way out, so the lobby is never a table
      // with a host standing beside it.
      await insertHomeGameSeat(row.id, hostId, homeGameSeats());
      return { ok: true, row };
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique home game id');
}

export async function homeGameView(id: string): Promise<HomeGameView | null> {
  const row = await getHomeGameById(id);
  if (!row) return null;
  const host = await getUserById(row.hostId);
  if (!host) return null;
  return {
    id: row.id,
    host: toUserSummary(host, await getRatingsFor(host.id)),
    seats: await seatViews(row.id, row.hostId),
    players: homeGameSeats(),
    rated: row.rated,
    botLevel: row.botLevel,
    status: statusOf(row),
    matchId: row.matchId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// The same three refusals every path that touches an open lobby owes the
// caller, in the order they stop being worth reporting.
function refuseUnlessOpen(row: HomeGameRow): Refusal | null {
  const state = statusOf(row);
  if (state === 'started') return { ok: false, status: 409, error: 'this table has already started' };
  if (state === 'cancelled') return { ok: false, status: 409, error: 'this table was cancelled' };
  if (state === 'expired') return { ok: false, status: 410, error: 'this link has expired' };
  return null;
}

export async function joinHomeGame(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const row = await getHomeGameById(id);
  if (!row) return { ok: false, status: 404, error: 'no such table' };
  const refusal = refuseUnlessOpen(row);
  if (refusal) return refusal;

  const seats = await getHomeGameSeats(id);
  if (seats.some((s) => s.userId === userId)) return { ok: true }; // already sitting here

  // A person can only be at one table at a time, and taking a seat here while
  // a match is running would abandon the one they are playing.
  if (roomForPlayer(userId)?.active) {
    return { ok: false, status: 409, error: 'you are already in a match. Finish it before joining a table.' };
  }

  const seated = await insertHomeGameSeat(id, userId, homeGameSeats());
  if (!seated) return { ok: false, status: 409, error: FULL };
  await pushLobby(row);
  return { ok: true };
}

export async function leaveHomeGame(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const row = await getHomeGameById(id);
  if (!row) return { ok: false, status: 404, error: 'no such table' };
  // The host leaving would leave a table nobody can start, so the way out of
  // your own table is to cancel it.
  if (row.hostId === userId) {
    return { ok: false, status: 400, error: 'this is your table. Cancel it instead of leaving it.' };
  }
  await deleteHomeGameSeat(id, userId);
  // The person who left is sent the same list everyone else gets, so their own
  // page can see they are no longer on it and offer the seat back.
  const list = await seatViews(id, row.hostId);
  hub.send(userId, { t: 'lobby', g: id, seats: list, status: statusOf(row) });
  await pushLobby(row, list);
  return { ok: true };
}

export interface HomeGameStart {
  ok: true;
  matchId: string;
  rated: boolean;
  // Why the table is casual when the host asked for rated, and null when it is
  // playing for what they asked for.
  reason: string | null;
}

/* Starting is the host's call and nobody else's: a home game gathers for as
   long as the host wants it to, and the empty chairs are filled with bots when
   they say so.

   A table with one human in it cannot be rated. Six seats of Glicko-2 against
   bots the host chose the strength of is a rating anyone could dial in, so the
   match plays casual instead and the answer says which choice was overridden
   rather than quietly changing it. */
export async function startHomeGame(id: string, userId: string): Promise<HomeGameStart | Refusal> {
  const row = await getHomeGameById(id);
  if (!row) return { ok: false, status: 404, error: 'no such table' };
  if (row.hostId !== userId) {
    return { ok: false, status: 403, error: 'only the host can start this table' };
  }
  const refusal = refuseUnlessOpen(row);
  if (refusal) return refusal;

  const seats = await getHomeGameSeats(id);
  const humans = seats.map((s) => s.userId);
  if (humans.length === 0) return { ok: false, status: 409, error: 'there is nobody at this table' };

  // Somebody who wandered off to another table cannot be dealt into this one.
  // The link keeps working, so the answer is to wait rather than to lose them.
  for (const seat of seats) {
    if (roomForPlayer(seat.userId)?.active) {
      const who = seat.userId === userId ? 'you are' : `${seat.name} is`;
      return { ok: false, status: 409, error: `${who} in a match right now. This table still works once it is over.` };
    }
  }

  const players = homeGameSeats();
  const needed = players - humans.length;
  const bots = await availableBotsAtLevel(row.botLevel, needed);
  if (bots.length < needed) {
    const info = botLevelInfo(row.botLevel);
    return {
      ok: false,
      status: 409,
      error: `every bot near ${info.name.toLowerCase()} is in a match. Try again in a moment.`,
    };
  }

  const rated = row.rated && humans.length >= 2;
  const reason = row.rated && !rated ? 'a table with one person at it plays casual: a rating needs two humans.' : null;

  const claimed = await claimHomeGame(id, userId);
  if (!claimed) return { ok: false, status: 409, error: 'this table has already started' };

  const base = matchFormat('six-max', rated);
  const format: MatchFormat = { ...base, rated, homeGame: true };
  try {
    // Seat order decides who takes the first button, so it is a shuffle rather
    // than a standing advantage for whoever made the link.
    const matchId = await createMatchForPlayers(shuffled([...humans, ...bots.map((b) => b.id)]), format);
    await setHomeGameMatch(id, matchId);
    await pushLobby({ ...claimed, matchId });
    return { ok: true, matchId, rated, reason };
  } catch (err) {
    // The lobby was claimed for a match that never came into being; giving it
    // back is better than eating somebody's table over a database error.
    await releaseHomeGame(id);
    throw err;
  }
}

export async function cancelHomeGame(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const row = await getHomeGameById(id);
  if (!row) return { ok: false, status: 404, error: 'no such table' };
  if (row.hostId !== userId) return { ok: false, status: 403, error: 'only the host can cancel this table' };
  const cancelled = await cancelOpenHomeGame(id, userId);
  if (!cancelled) {
    if (statusOf(row) === 'started') return { ok: false, status: 409, error: 'this table has already started' };
    return { ok: true }; // already cancelled, or expired: either way it is spent
  }
  await pushLobby(cancelled);
  return { ok: true };
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
