import { arenaPoints, type ArenaStanding, type ArenaStatus, type MatchFormat } from '@opentable/protocol';
import { config, shownAsBot } from './config.js';
import {
  addArenaResult,
  deleteArenaPlayer,
  ensureArena,
  finishArena,
  getArenaById,
  getArenaPlayers,
  getFinishedArenas,
  getOpenArenas,
  insertArenaPlayer,
  setArenaPaused,
  setArenaStatus,
  type ArenaPlayerRow,
  type ArenaRow,
} from './db.js';
import { availableBots } from './bots/index.js';
import { chargeNoShow, checkFor, openReadyCheck } from './ready.js';
import { createMatchForPlayers, matchFormat, randomMatchId, rankedUnlocked } from './matchmaking.js';
import { rankedBanMessage, rankedBanUntil } from './walkouts.js';
import { getRoom, roomForPlayer } from './match/rooms.js';
import { onMatchFinished } from './match/finished.js';
import { hub } from './ws/hub.js';

/* Arenas: the competitive loop.

   One event an hour, half an hour long, heads-up and rated. You join, and from
   then on you are paired again the moment your match ends. A win is worth two,
   a draw one, and a third win in a row is worth three. The board updates in
   front of everyone watching it.

   Everything here is background work on a timer, so the two rules the ladder
   learned apply again: nothing may throw out of a tick (this runs from a timer
   nobody awaits, and a rejection would take every live match with it), and
   everything a test needs to drive is a seam rather than a wall clock. The
   clock, the format and the schedule's period are all injected; `arenaTick` is
   one pass, exported the way `tick` and `ladderTick` are.

   An arena match is an ordinary rated heads-up match. `format.arena` carries
   the arena's id and is the only thing that makes it one: the same
   `createMatchForPlayers`, the same Glicko-2, the same public page. */

// The schedule. One on the hour, half an hour of poker.
const ARENA_EVERY_MS = 60 * 60 * 1000;
const ARENA_DURATION_MS = 30 * 60 * 1000;

// How many are kept waiting ahead of the current one, so the home page always
// has a next arena to count down to.
const ARENAS_AHEAD = 3;

// A match started this close to the end would still be playing when the board
// froze, so pairing stops here. Started matches play out (Lichess does the
// same) and the arena closes when the last one settles.
const LAST_PAIRING_BEFORE_END_MS = 3 * 60 * 1000;

// How long somebody waits for another person before a bot is brought in. Long
// enough that two people arriving a few seconds apart meet each other.
const BOT_FILL_MS = 8_000;

// Bots in arena matches at once. The roster is fifteen and the ladder needs
// some of it: an arena that could take every bot would starve the thing that
// gives the bots their ratings in the first place.
const MAX_ARENA_BOTS = 6;

/* An arena's ready check is shorter than the queue's. A player here has
   already said they are present by joining, is sitting on the arena page
   watching a board, and is paired again the moment their last match ends, so
   ten seconds is plenty and twenty out of a thirty minute event is not. */
const ARENA_READY_MS = 10_000;

// The pairing beat, and how often a board is pushed to the people watching it.
const PAIR_EVERY_MS = 2_000;
const PUSH_EVERY_MS = 5_000;

const ARENA_NAME = 'Hourly heads-up arena';

export interface ArenaOptions {
  enabled?: boolean;
  // The clock. A test runs the whole scheduler against a fake now, which is
  // the only way to watch an arena open, run and close without waiting half an
  // hour for it.
  now?: () => number;
  // The format an arena match is played on, the same seam the ladder's is: a
  // suite pairs on a 300 ms clock and two hands rather than twenty-five.
  format?: (arenaId: string) => MatchFormat;
  everyMs?: number;
  durationMs?: number;
  botFillMs?: number;
  lastPairingBeforeEndMs?: number;
}

function defaultArenaFormat(arenaId: string): MatchFormat {
  return { ...matchFormat('heads-up', true), arena: arenaId };
}

let enabled = config.arenaEnabled;
let now = () => Date.now();
let arenaFormat = defaultArenaFormat;
let everyMs = ARENA_EVERY_MS;
let durationMs = ARENA_DURATION_MS;
let botFillMs = BOT_FILL_MS;
let lastPairingBeforeEndMs = LAST_PAIRING_BEFORE_END_MS;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/* Who is waiting for a pairing and since when, keyed `<arena>:<user>`. In
   memory rather than on the row: it is a fact about the last few seconds, it
   is meaningless across a restart, and writing it would be a database write
   every two seconds per player. */
const waitingSince = new Map<string, number>();

/* Arena matches in flight, so the bot cap and the "playing" count are answers
   this module already has rather than a scan of every live room's format. */
const liveMatches = new Map<string, { arenaId: string; bots: number }>();

/* Who is looking at which arena. A page says so (the `arena` client message)
   rather than the server inferring it from who joined: watching an arena and
   being in one are different things, and the board is pushed to both. */
const watchers = new Map<string, Set<string>>(); // arena id -> user ids
const watching = new Map<string, string>(); // user id -> arena id

const lastPushAt = new Map<string, number>();

export function configureArena(opts: ArenaOptions): void {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.now !== undefined) now = opts.now;
  if (opts.format !== undefined) arenaFormat = opts.format;
  if (opts.everyMs !== undefined) everyMs = opts.everyMs;
  if (opts.durationMs !== undefined) durationMs = opts.durationMs;
  if (opts.botFillMs !== undefined) botFillMs = opts.botFillMs;
  if (opts.lastPairingBeforeEndMs !== undefined) lastPairingBeforeEndMs = opts.lastPairingBeforeEndMs;
}

// Back to the configured defaults with nothing in flight, so a suite that has
// finished with the arena does not leave the next file inheriting its clock.
export function resetArena(): void {
  stopArena();
  enabled = config.arenaEnabled;
  now = () => Date.now();
  arenaFormat = defaultArenaFormat;
  everyMs = ARENA_EVERY_MS;
  durationMs = ARENA_DURATION_MS;
  botFillMs = BOT_FILL_MS;
  lastPairingBeforeEndMs = LAST_PAIRING_BEFORE_END_MS;
  waitingSince.clear();
  liveMatches.clear();
  watchers.clear();
  watching.clear();
  lastPushAt.clear();
}

export function startArena(): void {
  if (timer || !enabled) return;
  timer = setInterval(() => {
    void arenaTick();
  }, PAIR_EVERY_MS);
}

export function stopArena(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/* ------------------------------------------------------------- schedule */

// The start of the period `at` falls in. Arenas are on the hour because the
// period divides the epoch, which is also what makes two processes scheduling
// the same arena agree on which one it is.
export function periodStart(at: number): number {
  return Math.floor(at / everyMs) * everyMs;
}

/* Keeps the schedule stocked. The current period is only worth opening while
   there is still time to pair in it; after that the next one is the next one.
   `arenas.starts_at` is unique, so two processes doing this at the same moment
   produce one arena, not two. */
async function ensureSchedule(): Promise<void> {
  const at = now();
  const current = periodStart(at);
  const starts: number[] = [];
  if (at < current + durationMs - lastPairingBeforeEndMs) starts.push(current);
  for (let i = 1; i <= ARENAS_AHEAD; i++) starts.push(current + i * everyMs);
  for (const start of starts) {
    await ensureArena(randomMatchId(), ARENA_NAME, new Date(start), new Date(start + durationMs));
  }
}

/* Opens and closes arenas. An arena closes when its clock has run out and the
   last match paired inside it has settled: a match that started before the end
   is played out and scored, which is the Lichess bargain, and freezing the
   board while one was still live would throw away a result somebody earned. */
async function moveStatuses(): Promise<void> {
  const at = now();
  for (const arena of await getOpenArenas()) {
    const startsAt = arena.startsAt.getTime();
    const endsAt = arena.endsAt.getTime();
    if (arena.status === 'upcoming' && at >= startsAt) {
      await setArenaStatus(arena.id, 'running');
      await pushArena(arena.id, true);
    }
    if (at >= endsAt && countLiveMatches(arena.id) === 0) await closeArena(arena);
  }
}

async function closeArena(arena: ArenaRow): Promise<void> {
  const rows = await getArenaPlayers(arena.id); // already in board order
  const places = rows.map((r, i) => ({ userId: r.userId, place: i + 1 }));
  const podium = rows
    .slice(0, 3)
    .map((r, i) => ({ uid: r.userId, avatarV: r.avatarV, name: r.name, score: r.score, place: i + 1 }));
  await finishArena(arena.id, places, podium);
  for (const key of [...waitingSince.keys()]) {
    if (key.startsWith(`${arena.id}:`)) waitingSince.delete(key);
  }
  await pushArena(arena.id, true);
}

/* -------------------------------------------------------------- pairing */

function key(arenaId: string, userId: string): string {
  return `${arenaId}:${userId}`;
}

function countLiveMatches(arenaId: string): number {
  let n = 0;
  for (const m of liveMatches.values()) if (m.arenaId === arenaId) n += 1;
  return n;
}

function countLiveBots(): number {
  let n = 0;
  for (const m of liveMatches.values()) n += m.bots;
  return n;
}

// A room that was abandoned never announces a result, so the register is swept
// rather than only written to: an entry whose room has stopped being active is
// an entry holding a bot back from the next table.
function pruneLiveMatches(): void {
  for (const [id] of liveMatches) {
    if (getRoom(id)?.active !== true) liveMatches.delete(id);
  }
}

/* Who can be paired right now. Being in the arena is not enough: a player at
   another table cannot be dealt into a second one, a paused player has said
   not to, and somebody whose socket has gone is not at the arena at all. The
   socket is what stands in for presence, and the pause toggle is what stands
   in for choice; there is no separate heartbeat, so a page left open in a
   background tab is still here, which is the same bargain the queue makes. */
function pairable(row: ArenaPlayerRow): boolean {
  if (row.paused) return false;
  // Already being asked whether they are ready for a table. Without this the
  // pairing beat, which runs every two seconds, would offer them a second one
  // while they were still deciding about the first.
  if (checkFor(row.userId)) return false;
  if (!hub.isConnected(row.userId)) return false;
  if (roomForPlayer(row.userId)?.active) return false;
  return true;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* One arena's pairings. Everyone waiting is ordered by score and then rating,
   and neighbours in that order are paired: the closest score there is, with
   the rating breaking a tie, which is what a Swiss-ish arena wants and what
   the board is already sorted by.

   Whoever is left over waits. Once they have waited `botFillMs` with nobody to
   meet, a bot is brought in at the nearest rating, exactly the way the human
   queue fills a lone player's table. Never two bots: a bot is only ever the
   second seat at a person's table. */
async function pairArena(arena: ArenaRow): Promise<void> {
  const at = now();
  if (at >= arena.endsAt.getTime() - lastPairingBeforeEndMs) return;

  const rows = await getArenaPlayers(arena.id);
  const ready = rows.filter(pairable);
  const readyIds = new Set(ready.map((r) => r.userId));
  for (const row of rows) {
    const k = key(arena.id, row.userId);
    if (readyIds.has(row.userId)) {
      if (!waitingSince.has(k)) waitingSince.set(k, at);
    } else {
      waitingSince.delete(k);
    }
  }

  // getArenaPlayers already orders by score, wins then rating, which is the
  // order neighbours are closest in.
  const paired = new Set<string>();
  for (let i = 0; i + 1 < ready.length; i += 2) {
    const a = ready[i];
    const b = ready[i + 1];
    await start(arena, [a.userId, b.userId], 0, [a.userId, b.userId]);
    paired.add(a.userId);
    paired.add(b.userId);
  }

  const left = ready.find((r) => !paired.has(r.userId));
  if (!left) return;
  const since = waitingSince.get(key(arena.id, left.userId)) ?? at;
  if (at - since < botFillMs) return;
  if (countLiveBots() >= MAX_ARENA_BOTS) return;
  const [bot] = await availableBots(left.rating, 1, 'heads-up');
  if (!bot) return;
  await start(arena, [left.userId, bot.id], 1, [left.userId]);
}

/* A pairing, offered rather than dealt. An arena can hand somebody a table
   four minutes after they wandered off, exactly as the queue can, so it asks
   the same question with the same machinery.

   What it does with a no-show is different. There is no queue to go back to
   and no cooldown that would mean anything inside a half-hour event, so the
   person who did not answer is paused, which is the arena's own word for "not
   to be paired", and their opponent is pairable again on the next beat with
   nothing having happened to them. The cooldown is still charged, because it
   is the queue's door they walk through next and a no-show is a no-show.

   Bots are picked before the check rather than after it, unlike the queue's:
   the window is ten seconds and the arena caps its own bot count, so a
   re-pick would be a second place for MAX_ARENA_BOTS to be counted. */
async function start(arena: ArenaRow, userIds: string[], bots: number, humans: string[]): Promise<void> {
  for (const id of userIds) waitingSince.delete(key(arena.id, id));

  const deal = async () => {
    // Seat order decides who takes the first button, so it is a shuffle rather
    // than an advantage for whoever the board happened to list first.
    const matchId = await createMatchForPlayers(shuffled(userIds), arenaFormat(arena.id));
    liveMatches.set(matchId, { arenaId: arena.id, bots });
  };

  const opened = openReadyCheck({
    id: randomMatchId(),
    format: arenaFormat(arena.id),
    seats: userIds.length,
    humans,
    windowMs: ARENA_READY_MS,
    start: deal,
    onCancel: (failed) => {
      for (const uid of failed) {
        chargeNoShow(uid);
        void pauseArena(arena.id, uid, true).catch(() => {
          /* the arena may have closed under them; the pause was the nicety */
        });
      }
    },
  });
  if (!opened) await deal();
}

/* --------------------------------------------------------------- scoring */

function outcomeFor(userId: string, winner: string | null): 'win' | 'loss' | 'draw' {
  if (winner === null) return 'draw';
  return winner === userId ? 'win' : 'loss';
}

/* A finished arena match onto the board. Bots are not arena players, so a bot
   seat simply has no row to move; the person across from it is scored exactly
   as they would be against anybody else, which is the point of letting a bot
   fill the seat at all.

   An arena that has already closed scores nothing. That is the freeze: the
   standings a page read at the end are the standings for good. */
async function scoreMatch(arenaId: string, playerIds: string[], winner: string | null): Promise<void> {
  const arena = await getArenaById(arenaId);
  if (!arena || arena.status !== 'running') return;
  const rows = await getArenaPlayers(arenaId);
  let scored = false;
  for (const userId of playerIds) {
    const row = rows.find((r) => r.userId === userId);
    if (!row) continue;
    const outcome = outcomeFor(userId, winner);
    const points = arenaPoints(outcome, row.streak);
    const streak = outcome === 'win' ? row.streak + 1 : 0;
    await addArenaResult(arenaId, userId, { points, outcome, streak });
    scored = true;
  }
  if (scored) await pushArena(arenaId, true);
}

// Registered once, at import: the arena is a listener on "a match finished"
// rather than something a match room knows about. See match/finished.ts.
onMatchFinished(async (match) => {
  const arenaId = match.format.arena;
  liveMatches.delete(match.id);
  if (!arenaId) return;
  await scoreMatch(arenaId, match.playerIds, match.winner);
});

/* ----------------------------------------------------------------- views */

const BOARD_ROWS = 20;

function toStanding(row: ArenaPlayerRow, rank: number): ArenaStanding {
  return {
    uid: row.userId,
    avatarV: row.avatarV,
    name: row.name,
    bot: shownAsBot(row.bot),
    ...(row.country ? { country: row.country } : {}),
    rating: Math.round(row.rating),
    rank,
    score: row.score,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    streak: row.streak,
    matches: row.matches,
    paused: row.paused,
  };
}

/* The board as one viewer sees it: the top twenty, and your own row appended
   when you are not in them, so a page always shows you where you are without
   sending three hundred rows to draw twenty. */
export function boardFor(
  rows: ArenaPlayerRow[],
  viewerId: string | null
): { standings: ArenaStanding[]; you: ArenaStanding | null } {
  const all = rows.map((row, i) => toStanding(row, i + 1));
  const standings = all.slice(0, BOARD_ROWS);
  const you = viewerId ? (all.find((s) => s.uid === viewerId) ?? null) : null;
  if (you && !standings.some((s) => s.uid === you.uid)) standings.push(you);
  return { standings, you };
}

export interface ArenaView {
  id: string;
  name: string;
  status: ArenaStatus;
  startsAt: Date;
  endsAt: Date;
  players: number;
  playing: number; // arena matches in progress
  standings: ArenaStanding[];
  you: ArenaStanding | null;
  podium: ArenaRow['podium'];
}

export async function arenaView(id: string, viewerId: string | null): Promise<ArenaView | null> {
  const arena = await getArenaById(id);
  if (!arena) return null;
  const rows = await getArenaPlayers(id);
  const { standings, you } = boardFor(rows, viewerId);
  return {
    id: arena.id,
    name: arena.name,
    status: arena.status,
    startsAt: arena.startsAt,
    endsAt: arena.endsAt,
    players: rows.length,
    playing: countLiveMatches(id),
    standings,
    you,
    podium: arena.podium,
  };
}

export interface ArenaSummary {
  id: string;
  name: string;
  status: ArenaStatus;
  startsAt: Date;
  endsAt: Date;
  players: number;
  podium: ArenaRow['podium'];
}

async function summarise(arena: ArenaRow): Promise<ArenaSummary> {
  const rows = await getArenaPlayers(arena.id);
  return {
    id: arena.id,
    name: arena.name,
    status: arena.status,
    startsAt: arena.startsAt,
    endsAt: arena.endsAt,
    players: rows.length,
    podium: arena.podium,
  };
}

/* What the arena page opens on: the one that is running, or the next one if
   none is, in full, with the last few finished ones under it. The schedule is
   stocked here as well as on the tick, so a fresh database answers this call
   with an arena rather than with nothing. */
export async function arenaListing(
  viewerId: string | null
): Promise<{ featured: ArenaView | null; finished: ArenaSummary[] }> {
  await ensureSchedule().catch((err) => console.error('arena schedule could not be stocked:', err));
  const open = await getOpenArenas();
  const running = open.find((a) => a.status === 'running');
  const featured = running ?? open[0] ?? null;
  return {
    featured: featured ? await arenaView(featured.id, viewerId) : null,
    finished: await Promise.all((await getFinishedArenas(3)).map(summarise)),
  };
}

/* ------------------------------------------------------------ the page */

export function watchArena(userId: string, arenaId: string | null): void {
  const previous = watching.get(userId);
  if (previous) {
    watchers.get(previous)?.delete(userId);
    watching.delete(userId);
  }
  if (!arenaId) return;
  watching.set(userId, arenaId);
  let set = watchers.get(arenaId);
  if (!set) {
    set = new Set();
    watchers.set(arenaId, set);
  }
  set.add(userId);
}

// A socket that has gone is a page that has gone. Called from the websocket
// router's disconnect, beside the queue's own tidy-up.
export function unwatchArena(userId: string): void {
  watchArena(userId, null);
}

/* The board to everyone looking at it. `force` is a score change or a status
   change, which goes out at once; without it the push is on the five second
   beat, so a busy arena costs one query a beat rather than one per viewer. */
async function pushArena(arenaId: string, force = false): Promise<void> {
  const set = watchers.get(arenaId);
  if (!set || set.size === 0) return;
  const at = now();
  if (!force && at - (lastPushAt.get(arenaId) ?? 0) < PUSH_EVERY_MS) return;
  lastPushAt.set(arenaId, at);

  const arena = await getArenaById(arenaId);
  if (!arena) return;
  const rows = await getArenaPlayers(arenaId);
  const playing = countLiveMatches(arenaId);
  for (const userId of set) {
    const { standings, you } = boardFor(rows, userId);
    hub.send(userId, {
      t: 'arena',
      a: arenaId,
      standings,
      you,
      status: arena.status,
      endsAt: arena.endsAt.getTime(),
      playing,
    });
  }
}

/* ------------------------------------------------------------- the door */

type Refusal = { ok: false; status: number; error: string };

export async function joinArena(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const arena = await getArenaById(id);
  if (!arena) return { ok: false, status: 404, error: 'No such arena' };
  if (arena.status === 'finished') {
    return { ok: false, status: 409, error: 'This arena is over. The next one is on the hour.' };
  }
  // An arena is rated heads-up, so it is the same door as the rated queue and
  // it asks the same thing first.
  if (!(await rankedUnlocked(userId))) {
    return {
      ok: false,
      status: 409,
      error: 'Play one casual game first. Arenas open as soon as it finishes.',
    };
  }
  // And the same ban. An arena is a ranked door like any other, so somebody
  // serving out a walkout does not get in through it.
  const banned = await rankedBanUntil(userId);
  if (banned !== null) {
    return { ok: false, status: 409, error: rankedBanMessage(banned) };
  }
  await insertArenaPlayer(id, userId);
  await pushArena(id, true);
  return { ok: true };
}

export async function leaveArena(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const arena = await getArenaById(id);
  if (!arena) return { ok: false, status: 404, error: 'No such arena' };
  if (arena.status === 'finished') {
    return { ok: false, status: 409, error: 'This arena is over. Its standings are final.' };
  }
  await deleteArenaPlayer(id, userId);
  waitingSince.delete(key(id, userId));
  await pushArena(id, true);
  return { ok: true };
}

/* Pausing is how you stay on the board without being dealt into another match.
   It is a toggle rather than a leave because leaving throws the score away,
   and somebody stepping out for five minutes has not stopped competing. */
export async function pauseArena(id: string, userId: string, paused: boolean): Promise<{ ok: true } | Refusal> {
  const arena = await getArenaById(id);
  if (!arena) return { ok: false, status: 404, error: 'No such arena' };
  const changed = await setArenaPaused(id, userId, paused);
  if (!changed) return { ok: false, status: 409, error: 'You are not in this arena. Join it first.' };
  if (paused) waitingSince.delete(key(id, userId));
  await pushArena(id, true);
  return { ok: true };
}

/* ---------------------------------------------------------------- tick */

/* One pass: stock the schedule, open and close what the clock says to, pair
   whoever is waiting, and push the boards that are due one. Exported so a test
   drives the scheduler a step at a time instead of waiting on the interval,
   the way `tick` is in matchmaking and `ladderTick` is in the ladder.

   Everything is wrapped, for the reason the ladder's is: this runs from a
   timer nobody awaits. */
export async function arenaTick(): Promise<void> {
  if (!enabled || ticking) return;
  ticking = true;
  try {
    pruneLiveMatches();
    await ensureSchedule();
    await moveStatuses();

    // The interval is the pairing beat, so a pass pairs; a test driving this
    // by hand pairs on every call rather than on a second clock of its own.
    for (const arena of (await getOpenArenas()).filter((a) => a.status === 'running')) {
      await pairArena(arena);
      await pushArena(arena.id);
    }
  } catch (err) {
    console.error('arena tick failed:', err);
  } finally {
    ticking = false;
  }
}
