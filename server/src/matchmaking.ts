import { randomBytes } from 'node:crypto';
import { anyone, groupQueue, pairQueue, widenRd, window as ratingWindow, type QueueEntry } from '@opentable/rating';
import {
  DEFAULT_MODE,
  DEFAULT_SPEED,
  MODES,
  RANKED_GATE_MATCHES,
  SPEEDS,
  botLevelInfo,
  formatFor,
  modesFor,
  speedOf,
  speedsFor,
  type MatchFormat,
  type Mode,
  type ModeChoice,
  type ReadyFailure,
  type Speed,
  type SpeedChoice,
} from '@opentable/protocol';
import { hub } from './ws/hub.js';
import {
  countUnratedFinished,
  getRating,
  getRatingsForUsers,
  getUserById,
  insertMatch,
  insertMatchPlayers,
  type MatchSeat,
} from './db.js';
import { chargeNoShow, cooldownUntil, declineReady, openReadyCheck } from './ready.js';
import { rankedBanMessage, rankedBanUntil } from './walkouts.js';
import { isUniqueViolation } from './pgError.js';
import { MatchRoom } from './match/room.js';
import { registerRoom } from './match/rooms.js';
import { availableBots, availableBotsAtLevel } from './bots/index.js';

export type { QueueEntry };

const MATCH_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // base32-ish, no ambiguous chars
const TICK_MS = 1000;

// How long a human waits before a bot is brought in, for both heads-up and
// six-max. Real players are matchmade with each other aggressively, whatever
// the gap (see `people` below), so this is only the fallback for whoever is
// left over. It has one branch: is there another real person around who
// might still turn into an opponent. Nobody else queued anywhere: a bot is
// brought in fast, because there is nothing to wait for. Somebody else is
// queued: wait a little longer, because a second human might still land on
// this exact table. Both were a single constant per mode until a second
// human queuing six seconds after a heads-up seat had already been given to
// a bot could never be matched with the first: gathering real players is
// worth a little patience, but not so much that a lone, genuinely alone
// visitor stares at a queue for the better part of a minute before anyone
// deals them a hand.
export const BOT_FILL_ALONE_MS = 30_000;
export const BOT_FILL_ACCOMPANIED_MS = 45_000;

let botFillAloneMs = BOT_FILL_ALONE_MS;
let botFillAccompaniedMs = BOT_FILL_ACCOMPANIED_MS;

// The one seam this file has for the fill clock, in the spirit of
// `configureArena` and `configureFriends`: a test that wants to watch a bot
// fill happen should not wait thirty or forty-five real seconds for it.
export function configureMatchmaking(opts: { botFillAloneMs?: number; botFillAccompaniedMs?: number } = {}): void {
  if (opts.botFillAloneMs !== undefined) botFillAloneMs = opts.botFillAloneMs;
  if (opts.botFillAccompaniedMs !== undefined) botFillAccompaniedMs = opts.botFillAccompaniedMs;
}

export function resetMatchmakingConfig(): void {
  botFillAloneMs = BOT_FILL_ALONE_MS;
  botFillAccompaniedMs = BOT_FILL_ACCOMPANIED_MS;
}

/* "Online" here means searching for a table right now, anywhere in the
   queue, not merely connected: a friend reading the leaderboard is present
   on the site but is never going to turn into this player's opponent, and
   counting them would buy nothing but a longer stare at the same empty
   table. It also is not narrowed to a compatible bucket, because by the time
   a bot-fill decision is being made a compatible human would already have
   been paired by `people()` above, whatever the gap - so a same-bucket check
   would almost always read false and the two thresholds would collapse into
   one. Reading the whole queue is a deliberate bet the other way: somebody
   searching for a different table right now is still a live visitor who
   might requeue or widen their own search, which is worth fifteen extra
   seconds of patience on a site this size. Bots never count: they are
   always around and would make the "alone" branch unreachable. */
function humansQueuedBesides(id: string): boolean {
  for (const entry of queue.values()) {
    if (!entry.bot && entry.id !== id) return true;
  }
  return false;
}

function botFillMs(id: string): number {
  return humansQueuedBesides(id) ? botFillAccompaniedMs : botFillAloneMs;
}

interface QueuedPlayer extends QueueEntry {
  /* What this search will accept, in the order it prefers. One entry each for
     a player who named a mode and a speed; two for one who said "any". The
     first is the one the search is described by and the one a bot fill falls
     back to, so a wide search still has a shape rather than being a shrug. */
  modes: Mode[];
  speeds: Speed[];
  rated: boolean;
  /* A population bot searching the ordinary queue. Both ticks pair the people
     among themselves before anything else is considered: a bot is what a
     person gets when no other person wants the same table. */
  bot: boolean;
}

/* One map, and the buckets are built per tick from what each search accepts.
   It used to be one queue per (mode, rated, speed) triple, eight of them that
   never paired across each other, because speed is a real third dimension: a
   twenty minute six-max table and a two hour one are different games, however
   alike their ratings are kept. They still are. What changed is that a player
   may now enter more than one of those queues at once by saying "any", which
   is a fact about the search rather than about the games, so it belongs here
   and not in the format. Rated is never widened: see `ModeChoice` in the
   protocol for why. */
const queue = new Map<string, QueuedPlayer>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

// Exported seam, like `tick` and `createMatchForPlayers`: tests replace this
// to run the real queue path against a short clock and a small stack instead
// of the 20-second, 200-unit product format.
let resolveFormat: (mode: Mode, rated: boolean, speed: Speed) => MatchFormat = formatFor;

export function setFormatResolver(fn: (mode: Mode, rated: boolean, speed: Speed) => MatchFormat): void {
  resolveFormat = fn;
}

// The resolver itself, for the paths that create a match outside the queue: a
// challenge link builds its format through here so the seam covers it too,
// and in production it is `formatFor` and nothing else.
export function matchFormat(mode: Mode, rated: boolean, speed: Speed = DEFAULT_SPEED): MatchFormat {
  return resolveFormat(mode, rated, speed);
}

// Exported so a challenge link can be minted from the same alphabet as a
// match id: both are short public ids people read off a URL, and there should
// only ever be one set of characters that appear in one.
export function randomMatchId(): string {
  let s = '';
  for (const b of randomBytes(8)) s += MATCH_ID_ALPHABET[b % MATCH_ID_ALPHABET.length];
  return s;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bucketKey(mode: Mode, rated: boolean, speed: Speed): string {
  return `${mode}:${rated}:${speed}`;
}

// Whether a search would sit down at this table.
function accepts(entry: QueuedPlayer, mode: Mode, rated: boolean, speed: Speed): boolean {
  return entry.rated === rated && entry.modes.includes(mode) && entry.speeds.includes(speed);
}

/* Rated play opens after one finished casual or practice match. Enforced here
   rather than only drawn on the home page, because the queue is the door and
   a disabled radio is a hint. It is deliberately a single match: enough that
   nobody's first ever hand moves a rating they had not noticed they had, and
   not so much that it reads as a grind. */
export async function rankedUnlocked(userId: string): Promise<boolean> {
  return (await countUnratedFinished(userId, RANKED_GATE_MATCHES)) >= RANKED_GATE_MATCHES;
}

export async function enqueue(
  userId: string,
  modeChoice: ModeChoice = DEFAULT_MODE,
  rated = true,
  speedChoice: SpeedChoice = DEFAULT_SPEED
): Promise<void> {
  const modes = modesFor(modeChoice);
  const speeds = speedsFor(speedChoice);
  // The mode the search is described by, rated at, and bot filled into: the
  // first one it accepts, which for a named choice is that choice.
  const mode = modes[0];
  const speed = speeds[0];
  if (queue.has(userId)) return;
  const user = await getUserById(userId);
  if (!user) return;

  // Three refusals before anything is entered, all of them about this player
  // rather than about this search, and all of them saying what happens next
  // rather than only that the answer is no.
  const until = cooldownUntil(userId);
  if (until !== null) {
    const seconds = Math.ceil((until - Date.now()) / 1000);
    hub.send(userId, {
      t: 'err',
      c: 'cooldown',
      msg: `You left a table waiting. You can search again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`,
    });
    return;
  }
  if (rated && !(await rankedUnlocked(userId))) {
    hub.send(userId, {
      t: 'err',
      c: 'ranked_locked',
      msg: 'Play one casual game first. Rated play opens as soon as it finishes.',
    });
    return;
  }
  // The walkout ban, and only on the rated queue: casual and practice are
  // the rooms somebody serving one is meant to still be able to play in.
  if (rated) {
    const banned = await rankedBanUntil(userId);
    if (banned !== null) {
      hub.send(userId, { t: 'err', c: 'ranked_ban', msg: rankedBanMessage(banned) });
      return;
    }
  }

  // The queue matches on the rating for the mode being queued for, so a
  // strong heads-up player enters the six-max queue at their six-max rating.
  // Speed is not part of that: one Glicko-2 pool per mode, with speed as a
  // tag, until the population supports splitting them.
  const standing = await getRating(userId, mode);
  const daysInactive = (Date.now() - standing.ratingAt.getTime()) / (24 * 60 * 60 * 1000);
  const widened = widenRd({ rating: standing.rating, rd: standing.rd, volatility: standing.volatility }, daysInactive);
  const entry: QueuedPlayer = {
    id: userId,
    rating: standing.rating,
    rd: widened.rd,
    joinedAt: Date.now(),
    modes,
    speeds,
    rated,
    bot: user.bot,
  };
  queue.set(userId, entry);
  sendSearching(entry, countIn(mode, rated, speed));
}

// How many people are searching right now, for the home page's stats strip.
// The population's bots search the same queue and are not people.
export function queueSize(): number {
  return [...queue.values()].filter((e) => !e.bot).length;
}

/* Practice: no queue, no wait, no rating. The seats around the player are
   filled from the roster at the level they asked for and outwards from it,
   and the match is created on the spot, so the searching screen resolves in
   the time one round trip takes rather than on the bot-fill timer the rated
   queues run on.

   `practice: true` rides on the format like every other format field, so it
   is persisted with the match and read back by anything that renders one. It
   is additive: a format stored before practice existed simply has no key. */
export async function enqueuePractice(
  userId: string,
  mode: Mode,
  level: number,
  speed: Speed = DEFAULT_SPEED
): Promise<void> {
  if (queue.has(userId)) dequeue(userId);
  const user = await getUserById(userId);
  if (!user) return;

  const base = resolveFormat(mode, false, speed);
  const format: MatchFormat = { ...base, rated: false, practice: true };
  const bots = await availableBotsAtLevel(level, format.players - 1);
  if (bots.length < format.players - 1) {
    const info = botLevelInfo(level);
    hub.send(userId, {
      t: 'err',
      c: 'bots_busy',
      msg: `Every bot near ${info.name.toLowerCase()} is in a match. Try again in a moment.`,
    });
    return;
  }

  await createMatchForPlayers(
    shuffled([userId, ...bots.map((b) => b.id)]),
    format
  );
}

/* Stop searching, on purpose. A player sitting in a ready check who presses
   this has not stopped searching, they have declined a table five other
   people are waiting on, so it goes down that path instead and costs what a
   decline costs. */
export function dequeue(userId: string): void {
  if (declineReady(userId)) return;
  if (queue.delete(userId)) {
    hub.send(userId, { t: 'q', s: 'left' });
  }
}

/* The socket dropped. Unlike an explicit cancel this leaves a pending ready
   check alone: the window is twenty seconds and a player who reconnects
   inside it can still accept, which is a much better answer than charging a
   cooldown for a blip. If they do not come back the check times out and
   charges them then. */
export function dequeueOnDisconnect(userId: string): void {
  if (queue.delete(userId)) {
    hub.send(userId, { t: 'q', s: 'left' });
  }
}

// How many searches would sit down at this table. A player who said "any" is
// counted in every table they would take, which is the honest answer to "how
// many people are waiting for a game you could be in".
function countIn(mode: Mode, rated: boolean, speed: Speed): number {
  let n = 0;
  for (const e of queue.values()) if (accepts(e, mode, rated, speed)) n += 1;
  return n;
}

function sendSearching(entry: QueuedPlayer, gathered: number): void {
  const now = Date.now();
  const window = ratingWindow(entry, now);
  const waited = Math.floor((now - entry.joinedAt) / 1000);
  // window() returns Infinity once the search is unbounded; that doesn't
  // survive JSON.stringify (becomes null), so drop the field instead of
  // passing it through raw. It is also derived from a rating deviation,
  // which is a float, and nobody reads a rating range to the decimal.
  const range = Number.isFinite(window) ? Math.round(window) : undefined;
  // Described by the search's first choice: a wide search is still looking
  // for something in particular first, and "searching for a table" with no
  // table named reads as the client having lost track of what it asked for.
  const seats = resolveFormat(entry.modes[0], entry.rated, entry.speeds[0]).players;
  hub.send(entry.id, {
    t: 'q',
    s: 'searching',
    w: waited,
    range,
    mode: entry.modes[0],
    rated: entry.rated,
    speed: entry.speeds[0],
    ...(seats > 2 ? { seated: Math.min(gathered, seats) } : {}),
  });
}

// Parameterized by format so tests can create a match with a short
// clockMs/graceMs instead of the real 20s/15s, bypassing the queue entirely.
export async function createMatchForPlayers(
  userIds: string[],
  format: MatchFormat = formatFor(DEFAULT_MODE, true)
): Promise<string> {
  const users = await Promise.all(userIds.map((id) => getUserById(id)));
  if (users.some((u) => u === null)) throw new Error('every seat must exist to create a match');
  // Seats carry the rating for this match's mode, which is what SeatView
  // shows at the table.
  const standings = await getRatingsForUsers(userIds, format.mode);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomMatchId();
    const seats: MatchSeat[] = users.map((u, i) => ({
      seat: i,
      userId: u!.id,
      name: u!.name,
      rating: Math.round(standings.get(u!.id)!.rating),
      bot: u!.bot,
      guest: u!.guest,
      avatarV: u!.avatarV,
      // A practice table's bots are bots, not people from somewhere: no flag.
      ...(u!.country && !(format.practice === true && u!.bot) ? { country: u!.country } : {}),
    }));
    try {
      const match = await insertMatch(id, format, seats, format.rated);
      await insertMatchPlayers(
        id,
        seats.map((s) => ({ userId: s.userId, seat: s.seat }))
      );
      const room = new MatchRoom(match);
      registerRoom(room);
      await room.start();
      for (const s of seats) {
        hub.send(s.userId, {
          t: 'q',
          s: 'found',
          m: id,
          mode: format.mode,
          rated: format.rated,
          speed: speedOf(format),
        });
      }
      return id;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique match id');
}

/* A gathered table, offered rather than dealt. Everybody in it comes out of
   the queue for the length of the check, so nobody is offered two tables at
   once and nothing else can pair them while they decide.

   The bots are picked inside `start` and not here. Twenty seconds is long
   enough for another table to take the one this group was going to sit with,
   and a table that starts with a bot in a match somewhere else is a table
   with an empty chair.

   A failed check puts everybody who did accept back exactly as they were,
   original `joinedAt` and all, which is what "the front of the queue" means
   here: both pairing functions order by how long somebody has waited, so
   preserving the timestamp is preserving the place, and it does it without a
   second notion of priority existing anywhere. */
function launch(entries: QueuedPlayer[], botCount: number, format: MatchFormat): void {
  for (const e of entries) queue.delete(e.id);
  const id = randomMatchId();
  const humans = entries.map((e) => e.id);

  const opened = openReadyCheck({
    id,
    format,
    seats: format.players,
    humans,
    start: async () => {
      const bots =
        botCount > 0 ? await availableBots(meanRating(entries), botCount, format.mode) : [];
      if (bots.length < botCount) {
        // The roster emptied while they were deciding. Nobody is at fault, so
        // nobody is charged: they go back to searching where they were.
        for (const e of entries) requeue(e);
        return;
      }
      await createMatchForPlayers(shuffled([...humans, ...bots.map((b) => b.id)]), format);
    },
    onCancel: (failed, kept, why) => {
      for (const uid of failed) chargeNoShow(uid);
      for (const e of entries) {
        if (kept.includes(e.id)) requeue(e);
      }
      void why;
    },
  });

  // Refused only when one of these players is somehow already in a check,
  // which the queue's own bookkeeping should make impossible. Putting them
  // back is the safe answer either way.
  if (!opened) for (const e of entries) requeue(e);
}

/* Back into the queue with the place they had. No `q searching` is sent from
   here: the tick that follows sends one to everybody in the queue anyway, and
   the client has just been told by the `ready cancelled` message why it is
   searching again. */
function requeue(entry: QueuedPlayer): void {
  if (!queue.has(entry.id)) queue.set(entry.id, entry);
}

function meanRating(entries: QueuedPlayer[]): number {
  if (entries.length === 0) return 1500;
  return entries.reduce((sum, e) => sum + e.rating, 0) / entries.length;
}

/* People first, whatever the gap. Two people who want the same table are
   paired the moment both are there, closest ratings first but with no rating
   window at all: on a site this size a person is worth more than a close
   rating, and the alternative was one of them dealt in against a bot by
   the fill below while the other searched. Only then are the bots in the
   queue considered, on the ordinary windows, for whoever is left. */
function people(entries: QueuedPlayer[]): [QueuedPlayer[], QueuedPlayer[]] {
  return [entries.filter((e) => !e.bot), entries.filter((e) => e.bot)];
}

async function tickHeadsUp(entries: QueuedPlayer[], format: MatchFormat, now: number): Promise<void> {
  const [humans] = people(entries);
  for (const [a, b] of pairQueue(humans, now, anyone)) {
    if (!queue.has(a.id) || !queue.has(b.id)) continue;
    launch([a, b], 0, format);
  }
  for (const [a, b] of pairQueue(entries.filter((e) => queue.has(e.id)), now)) {
    if (!queue.has(a.id) || !queue.has(b.id)) continue;
    launch([a, b], 0, format);
  }

  // Nobody left to pair with: give whoever has been waiting longest a bot
  // rather than an empty room. The roster is asked here only so a table is
  // not offered when there is nothing to fill it with; the bot itself is
  // picked again when the check passes.
  const waiting = entries.filter((e) => queue.has(e.id)).sort((a, b) => a.joinedAt - b.joinedAt);
  for (const entry of waiting) {
    if (now - entry.joinedAt < botFillMs(entry.id)) continue;
    const [bot] = await availableBots(entry.rating, 1, format.mode);
    if (!bot) return;
    launch([entry], 1, format);
  }
}

async function tickMultiway(entries: QueuedPlayer[], format: MatchFormat, now: number): Promise<void> {
  const [persons] = people(entries);
  for (const group of groupQueue(persons, format.players, now, anyone)) {
    if (group.some((e) => !queue.has(e.id))) continue;
    launch(group, 0, format);
  }
  for (const group of groupQueue(entries.filter((e) => queue.has(e.id)), format.players, now)) {
    if (group.some((e) => !queue.has(e.id))) continue;
    launch(group, 0, format);
  }

  /* The fill seats every person waiting here first, longest wait first,
     and only then the bots that were searching alongside them. */
  const waiting = entries
    .filter((e) => queue.has(e.id))
    .sort((a, b) => Number(a.bot) - Number(b.bot) || a.joinedAt - b.joinedAt);
  if (waiting.length === 0) return;
  if (now - waiting[0].joinedAt < botFillMs(waiting[0].id)) return;

  // Six-max fills with bots after the threshold, ranked included. Ranked
  // used to wait for six people, which with one person on the site meant it
  // never dealt at all; bots are the population for now, their matches are
  // rated the same way heads-up bot fills already are, and the pool branch
  // makes them ordinary opponents in the queue anyway.
  const humans = waiting.slice(0, format.players);
  const needed = format.players - humans.length;
  const bots = needed > 0 ? await availableBots(meanRating(humans), needed, format.mode) : [];
  // Bots never fill a table with no human, and a short roster waits rather
  // than seating a table that isn't full.
  if (humans.length === 0 || humans.length + bots.length < format.players) return;
  launch(humans, needed, format);
}

// Exported for the tests that assert what a search accepts, which is a fact
// about the entry rather than about any table it might land at.
export function __queueForTest(): ReadonlyMap<string, { modes: Mode[]; speeds: Speed[]; rated: boolean }> {
  return queue;
}

// Exported so tests can pair a queue deterministically instead of waiting on
// the real interval.
export async function tick(): Promise<void> {
  const now = Date.now();

  /* **A search can stand in more than one bucket.** The tables are still the
     real (mode, rated, speed) triples and pairing still happens inside one of
     them; a player who said "any" is simply considered for every table they
     would take. Both pairing paths already drop anyone `queue` no longer
     holds, so somebody seated by the first bucket they appear in is skipped
     by the rest.

     Shuffled, because the order tables are considered in decides which one a
     wide search falls into when several could take it, and a fixed order
     would quietly make the first table the only one that ever fills. */
  const buckets = new Map<string, { mode: Mode; rated: boolean; speed: Speed; entries: QueuedPlayer[] }>();
  for (const rated of [true, false]) {
    for (const mode of MODES) {
      for (const speed of SPEEDS) {
        const entries = [...queue.values()].filter((e) => accepts(e, mode, rated, speed));
        if (entries.length > 0) buckets.set(bucketKey(mode, rated, speed), { mode, rated, speed, entries });
      }
    }
  }

  for (const bucket of shuffled([...buckets.values()])) {
    const entries = bucket.entries.filter((e) => queue.has(e.id));
    if (entries.length === 0) continue;
    const format = resolveFormat(bucket.mode, bucket.rated, bucket.speed);
    if (format.players > 2) await tickMultiway(entries, format, now);
    else await tickHeadsUp(entries, format, now);
  }

  for (const entry of queue.values()) {
    sendSearching(entry, countIn(entry.modes[0], entry.rated, entry.speeds[0]));
  }
}

export function startMatchmaking(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    void tick();
  }, TICK_MS);
}

export function stopMatchmaking(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}
