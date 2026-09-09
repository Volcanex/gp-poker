import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import { config } from './config.js';
import { getLadderMatchCounts, getRatingsForUsers, type UserRow } from './db.js';
import { availableBots, levelOf } from './bots/index.js';
import { createMatchForPlayers, queueSize } from './matchmaking.js';
import { getRoom, liveRooms } from './match/rooms.js';

/* The bot ladder. Bots play each other, rated, one match at a time, in the
   gaps when nobody is here.

   It exists because of a number that was a lie. The practice picker shows
   each level's live average rating, and every bot starts at 1500, so before
   the ladder a level 1 bot and a level 5 bot both read "1500" and the picker
   said nothing. Bots playing bots is the one sanctioned bot-only table: the
   human queues still never seat one. Fifteen bots of five strengths playing
   each other is exactly the round robin that spreads them out, and it is the
   same rated path a human match takes, so a human who beats a level 3 bot
   beats something with a number it earned.

   Humans come first for the bots' time. A ladder match starts only when the
   queue is empty and no person is at a table anywhere; one that is already
   running is left to finish (it is short) rather than being torn out from
   under a rating that was half computed. */

// Bots do not need to be watched, so a ladder table runs on a short clock
// and a short hold, and does not pace an all-in run-out at all: the pacing
// exists to be looked at and nobody is looking. They still think on their own
// timer, which is capped at a quarter of the clock, so this is what sets
// their pace.
const LADDER_CLOCK_MS = 5_000;
const LADDER_HOLD_MS = 1_000;
const LADDER_RUNOUT_TICK_MS = 0;

// One six-max for every four heads-up. Heads-up is where the rating signal
// is cleanest and six-max is where a level has to hold up against five
// others, so both need to happen and the cheap one happens more.
const SIX_MAX_EVERY = 5;

// Tables remembered, so the same two bots do not keep meeting while a third
// waits. Relaxed rather than enforced: if everyone free has just played the
// anchor, a rematch beats not playing.
const RECENT_TABLES = 5;

// How often the scheduler looks: often enough to notice a match ending, and
// never longer than the pause it is waiting out anyway.
const POLL_MS = 1_000;

export interface LadderOptions {
  enabled?: boolean;
  pauseMs?: number;
  // Test seam, the same shape as matchmaking's `setFormatResolver`: a suite
  // runs the real scheduler against a 300 ms clock rather than sitting
  // through twenty-five hands of the product format.
  format?: (mode: Mode) => MatchFormat;
}

function defaultLadderFormat(mode: Mode): MatchFormat {
  return {
    ...formatFor(mode, true),
    ladder: true,
    clockMs: LADDER_CLOCK_MS,
    holdMs: LADDER_HOLD_MS,
    runoutTickMs: LADDER_RUNOUT_TICK_MS,
  };
}

let enabled = config.ladderEnabled;
let pauseMs = config.ladderPauseMs;
let ladderFormat = defaultLadderFormat;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let currentMatchId: string | null = null;
let nextStartAt = 0;
let started = 0;
const recentTables: string[][] = [];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

// One line a match, at info. LOG_LEVEL is warn by default, so this is silent
// on the box until someone asks to watch the ladder. Fastify's logger is not
// used because nothing here has a request or an app, and reaching for the
// instance would couple the scheduler to the http server it does not need.
function info(msg: string): void {
  if (LOG_LEVELS.indexOf(config.logLevel) <= LOG_LEVELS.indexOf('info')) console.log(msg);
}

export function configureLadder(opts: LadderOptions): void {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.pauseMs !== undefined) pauseMs = opts.pauseMs;
  if (opts.format !== undefined) ladderFormat = opts.format;
}

// Back to the configured defaults with no match in flight, for a test that
// has finished with the ladder and does not want the next file inheriting it.
export function resetLadder(): void {
  stopLadder();
  enabled = config.ladderEnabled;
  pauseMs = config.ladderPauseMs;
  ladderFormat = defaultLadderFormat;
  currentMatchId = null;
  nextStartAt = 0;
  started = 0;
  recentTables.length = 0;
}

// The ladder match being played, or null. Exported for tests and for anything
// that wants to know whether the bots are busy with themselves.
export function currentLadderMatch(): string | null {
  return currentMatchId;
}

export function startLadder(): void {
  if (timer || !enabled) return;
  nextStartAt = Date.now() + pauseMs;
  timer = setInterval(() => {
    void ladderTick();
  }, Math.max(20, Math.min(POLL_MS, pauseMs)));
}

export function stopLadder(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Is anybody here? A person searching or a person at a table both mean the
// bots have better things to do than play each other.
function humansBusy(): boolean {
  if (queueSize() > 0) return true;
  return liveRooms().some((room) => room.playerIds.some((id) => levelOf(id) === null));
}

function metRecently(a: string, b: string): boolean {
  return recentTables.some((table) => table.includes(a) && table.includes(b));
}

function remember(ids: string[]): void {
  recentTables.unshift(ids);
  if (recentTables.length > RECENT_TABLES) recentTables.length = RECENT_TABLES;
}

/* Who plays next. The anchor is whoever has played fewest ladder matches, so
   every bot gets a turn rather than the two nearest in rating playing all
   night. Its opposition comes from the least-played half of everyone else,
   nearest in rating first: a turn is worth taking against someone whose
   rating the result will actually move. */
async function pickTable(mode: Mode, seats: number): Promise<UserRow[] | null> {
  // availableBots is already the free-bot filter the human queues use, so a
  // bot in a practice table or a human's match is not offered here either.
  const free = await availableBots(1500, config.botCount, mode);
  if (free.length < seats) return null;

  const counts = await getLadderMatchCounts();
  const standings = await getRatingsForUsers(
    free.map((u) => u.id),
    mode
  );
  const played = (u: UserRow) => counts.get(u.id) ?? 0;
  const rating = (u: UserRow) => standings.get(u.id)?.rating ?? 1500;

  const byPlayed = shuffled(free).sort((a, b) => played(a) - played(b));
  const anchor = byPlayed[0];
  const others = byPlayed.slice(1);

  const fresh = others.filter((u) => !metRecently(anchor.id, u.id));
  const pool = fresh.length >= seats - 1 ? fresh : others;
  const half = pool.slice(0, Math.max(seats - 1, Math.ceil(pool.length / 2)));
  half.sort((a, b) => Math.abs(rating(a) - rating(anchor)) - Math.abs(rating(b) - rating(anchor)));

  return [anchor, ...half.slice(0, seats - 1)];
}

/* One pass. Exported so a test can drive the scheduler a step at a time
   instead of waiting on the interval, the way `tick` is in matchmaking.

   Everything in here is wrapped: this runs from a timer nobody awaits, and a
   rejection that escapes it would take the process down and every live match
   with it, which is the one thing a background bot game must never do. */
export async function ladderTick(): Promise<void> {
  if (!enabled || ticking) return;
  ticking = true;
  try {
    if (currentMatchId) {
      const room = getRoom(currentMatchId);
      // Gone from the registry means abandoned; not active means finished.
      // Either way the ladder is free again after the pause.
      if (room?.active) return;
      currentMatchId = null;
      nextStartAt = Date.now() + pauseMs;
      return;
    }
    if (Date.now() < nextStartAt) return;
    if (humansBusy()) return;

    const mode: Mode = started % SIX_MAX_EVERY === SIX_MAX_EVERY - 1 ? 'six-max' : 'heads-up';
    const format = ladderFormat(mode);
    const table = await pickTable(mode, format.players);
    // Not enough free bots: try again on the next poll rather than seating a
    // short table.
    if (!table) return;

    const ids = shuffled(table.map((u) => u.id));
    currentMatchId = await createMatchForPlayers(ids, format);
    started += 1;
    remember(ids);
    info(`ladder ${currentMatchId} ${mode}: ${table.map((u) => `${u.name}(L${levelOf(u.id) ?? u.botLevel})`).join(' v ')}`);
  } catch (err) {
    console.error('ladder match could not be started:', err);
    currentMatchId = null;
    nextStartAt = Date.now() + pauseMs;
  } finally {
    ticking = false;
  }
}
