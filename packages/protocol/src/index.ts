/* Wire protocol v5. JSON over WebSocket, short keys, every message carries t.
   The server is authoritative: clients send intent only. Any change to the
   shapes below is a protocol change: bump PROTOCOL_VERSION and keep the
   server accepting the previous one for a deploy cycle. v4 was additive: the
   `arena` message in both directions and `format.arena`, so a v3 client that
   never sends one is served unchanged. Profile pictures and flags were
   additive inside v4 for the same reason: `avatarV` and `country` are optional
   on every shape that carries them, and a client that has never heard of
   either draws the generated avatar and no flag, as it always did.

   v5 is the first break, and it is the ready check that makes it one. Speed
   is additive (`format.speed`, `format.levelSeconds`, `TableView.level`, all
   optional and all defaulting to what a v4 format already meant), but a
   matchmade table now waits for every human to accept it, and a v4 client
   neither draws the prompt nor sends `ready`. It would sit through the
   countdown, be dropped as a no-show and collect a cooldown for it, so this
   one cannot be served unchanged.

   The practice hold was additive inside v5: `ClientMsg.next` and
   `TableView.hold` are both new and both optional, and a client that never
   sends `next` simply never un-holds a practice table beyond the safety
   timeout, which is exactly the behaviour it had before either existed.

   The all-in run-out is additive inside v5 for the same reason: `TableView
   .runout` and `format.runoutTickMs` are both new and both optional, and a
   client that has never heard of either draws a board arriving a street at a
   time with the hole cards already face up, which is what it drew before,
   with no countdown over it. What changed underneath it is not a shape but a
   meaning: on a run-out `street` and `board` say how much of it the table has
   been shown rather than how much the engine has resolved, and `result`
   arrives when the river does. Nothing reads those fields in a way that
   change breaks.

   Leaving a match was additive inside v5 too: `ClientMsg.resign`, the
   `ranked_ban` error code and the `left` match reason are all new, and a
   client that never sends `resign` is served exactly as it was. An older
   client reading a `left` result falls through to no reason line rather than
   to a wrong one. */

export const PROTOCOL_VERSION = 5;

export type Card = string; // 'As', 'Td', '2c' (rank + suit, lowercase suit)

export type ActionKind = 'f' | 'x' | 'c' | 'b' | 'r' | 'a'; // fold check call bet raise all-in
export type Street = 'pre' | 'flop' | 'turn' | 'river' | 'showdown' | 'done';

export type Mode = 'heads-up' | 'six-max';

/* How fast a table is played. One dimension beside the mode, the way a chess
   site keeps bullet apart from classical: `fast` is the twenty minute game
   with a ten second clock, `standard` is the two hour one this site started
   with. Ratings are NOT split by it. There is one Glicko-2 pool per mode and
   the speed rides along as a tag, because four pools need four populations
   and this site has one. Split them when the population supports it. */
export type Speed = 'fast' | 'standard';

export const SPEEDS: Speed[] = ['fast', 'standard'];
export const SPEED_NAME: Record<Speed, string> = { fast: 'Fast', standard: 'Standard' };

export interface MatchFormat {
  mode: Mode;
  players: number; // seats at the table: 2 for heads-up, 6 for six-max
  rated: boolean;
  hands: number | null; // heads-up: match ends after this many hands unless someone busts; null = until one player has every chip
  stack: number; // starting stack in table units
  sb: number; // level 1 blinds; kept flat so old readers still work
  bb: number;
  levels: { sb: number; bb: number }[]; // blind schedule; a single entry means blinds never escalate
  levelHands: number; // hands per level, 0 for no hand basis at all (a fast format climbs on the clock instead)
  clockMs: number; // per-decision clock
  graceMs: number; // reconnect grace before the clock runs while disconnected
  /* Seconds of elapsed match time per level, the other basis the schedule can
     climb on. Optional, and absent means zero, which is exactly what every
     format stored before speed existed meant: hands only. Where both bases
     are set the level is whichever is further along, so the clock cannot
     un-climb a schedule that the hands already climbed. */
  levelSeconds?: number;
  /* Fast or standard. Optional for the same reason: a format stored before
     this existed was the standard one, and `speedOf` is where that default is
     spelled so nothing else has to remember it. */
  speed?: Speed;
  // A practice table: one human, the rest bots of a chosen level, never
  // rated. Optional so a format stored before practice existed still parses.
  practice?: boolean;
  // A ladder table: bots playing each other in the background so their
  // ratings are earned rather than assumed. Rated like any bot match, but
  // kept out of the live list and the feed, because nobody is at it.
  ladder?: boolean;
  // Overrides HAND_HOLD_MS for this format. A ladder hand has no one
  // watching it, so it does not pause four seconds to be watched.
  holdMs?: number;
  // Overrides RUNOUT_TICK_MS: how long one tick of an all-in run-out's
  // countdown lasts. Zero turns the pacing off altogether and the whole board
  // arrives at once, which is what a ladder table wants for the same reason
  // it wants no hold, and what a test wants rather than sitting through nine
  // real seconds of countdown.
  runoutTickMs?: number;
  // Overrides PRACTICE_HOLD_TIMEOUT_MS: how long a practice table waits for
  // the human to send `next` before dealing on by itself. Only meaningful
  // with `practice: true`; a test shrinks it rather than actually waiting
  // two minutes for the fallback to prove itself.
  practiceHoldTimeoutMs?: number;
  // A home game: a private six-max table a host gathered by link, with bots
  // in whatever seats nobody took. Optional for the same reason `practice`
  // is: a format stored before home games existed simply has no key.
  homeGame?: boolean;
  // The arena this match was paired for, by arena id. An arena match is an
  // ordinary rated heads-up match in every other way, so this is the only
  // thing that tells the scorer, the feed and the table it belongs to one.
  arena?: string;
}

export function speedOf(format: MatchFormat): Speed {
  return format.speed === 'fast' ? 'fast' : 'standard';
}

/* ------------------------------------------------------------- the clock

   Two promises, and the blind schedules below are built to keep them: a fast
   table is over inside twenty minutes and a standard one inside two hours.
   Both are enforced by the blinds rather than by a timer that stops a hand,
   because a hand cut off halfway is not a poker result. */
export const FAST_CEILING_MS = 20 * 60_000;
export const STANDARD_CEILING_MS = 120 * 60_000;

export function ceilingFor(speed: Speed): number {
  return speed === 'fast' ? FAST_CEILING_MS : STANDARD_CEILING_MS;
}

/* What a hand costs once the blinds have passed every stack at the table.
   Nobody has a decision to make: the seats are all-in from the blinds, so the
   hand is a deal, four streets and a showdown with no clock in it at all.
   Six seconds is generous for that, and it is only ever used to prove the
   endgame fits inside the ceiling, never to pace anything. */
export const FORCED_HAND_MS = 6_000;

/* When a level begins, in elapsed match time. Level 0 begins at zero; a
   format with no time basis has every level beginning at zero, which is the
   honest answer for a schedule that climbs on hands alone. */
export function levelStartMs(format: MatchFormat, level: number): number {
  const seconds = format.levelSeconds ?? 0;
  if (seconds <= 0) return 0;
  return Math.max(0, level) * seconds * 1_000;
}

/* When the top level begins. From there the blinds never move again, and the
   top level of every schedule below is one where the big blind is at least
   half of every chip on the table, so each hand puts somebody all-in and
   busts them. */
export function terminalLevelMs(format: MatchFormat): number {
  return levelStartMs(format, format.levels.length - 1);
}

/* The longest this format can possibly run: the moment the top level begins,
   plus the hands it takes to knock out everybody but one from there. Each of
   those hands is forced, so it costs FORCED_HAND_MS plus the hold, and each
   one busts at least one player, so there are at most `players - 1` of them.

   This is the number the schedules are actually designed against, and
   `speed.test.ts` on the server is what holds them to it. */
export function matchCeilingMs(format: MatchFormat): number {
  const endgame = (format.players - 1) * (FORCED_HAND_MS + holdFor(format));
  return terminalLevelMs(format) + endgame;
}

/* -------------------------------------------------------- the schedules

   Every table starts on 200 units a seat, so the chips in play are
   200 * players: 400 heads-up, 1200 six handed. A schedule ends a table by
   making the big blind large against that total, and it ends it *provably*
   once the big blind is at least half the total, because then no seat can
   post one without being all-in and every hand busts somebody.

   The arithmetic for each of the four is written above it. Read the stack to
   big blind ratio as the average one: 200 units against the level's bb. */

/* Fast heads-up. 400 chips in play, a level every 90 seconds.

     level  blinds    starts at   avg stack in bb   table total in bb
       1     1/2        0:00          100                200
       2     2/4        1:30           50                100
       3     3/6        3:00           33                 66
       4     5/10       4:30           20                 40
       5     8/16       6:00           12.5               25
       6     12/25      7:30            8                 16
       7     20/40      9:00            5                 10
       8     30/60     10:30            3.3                6.6
       9     50/100    12:00            2                  4
      10    100/200    13:30            1                  2
      11    200/400    15:00            0.5                1     <- top

   At the top level the big blind is the whole table, so both seats are
   all-in the moment the blinds are posted and one hand settles it: 15:00 plus
   one forced hand, comfortably inside twenty minutes. In practice a bust
   arrives around level 6 or 7. The 25 hand cap stays, so a fast heads-up
   match is still "best of 25 or bust", now with a clock behind it. */
export const HEADS_UP_FAST: MatchFormat = {
  mode: 'heads-up',
  speed: 'fast',
  players: 2,
  rated: true,
  hands: 25,
  stack: 200,
  sb: 1,
  bb: 2,
  levels: [
    { sb: 1, bb: 2 },
    { sb: 2, bb: 4 },
    { sb: 3, bb: 6 },
    { sb: 5, bb: 10 },
    { sb: 8, bb: 16 },
    { sb: 12, bb: 25 },
    { sb: 20, bb: 40 },
    { sb: 30, bb: 60 },
    { sb: 50, bb: 100 },
    { sb: 100, bb: 200 },
    { sb: 200, bb: 400 },
  ],
  levelHands: 0, // the clock is the only basis: a short table climbs on time
  levelSeconds: 90,
  clockMs: 10_000,
  graceMs: 8_000,
};

/* Fast six-max. 1200 chips in play, a level every 90 seconds.

     level  blinds    starts at   avg stack in bb   table total in bb
       1     1/2        0:00          100                600
       2     2/4        1:30           50                300
       3     3/6        3:00           33                200
       4     5/10       4:30           20                120
       5     8/16       6:00           12.5                75
       6     12/25      7:30            8                  48
       7     20/40      9:00            5                  30
       8     30/60     10:30            3.3                20
       9     50/100    12:00            2                  12
      10     75/150    13:30            1.3                 8
      11    100/200    15:00            1                   6
      12    150/300    16:30            0.7                  4
      13    300/600    18:00            0.3                  2    <- top

   From level 11 the average stack is under a big blind, so the table is
   already collapsing; the top level makes it certain, since 600 is half of
   every chip on the table and five forced hands is the worst case. 18:00 plus
   five of them is 18:50. Most fast six-max tables are over by minute twelve,
   which is the point: this is the bullet game. */
export const SIX_MAX_FAST: MatchFormat = {
  mode: 'six-max',
  speed: 'fast',
  players: 6,
  rated: true,
  hands: null,
  stack: 200,
  sb: 1,
  bb: 2,
  levels: [
    { sb: 1, bb: 2 },
    { sb: 2, bb: 4 },
    { sb: 3, bb: 6 },
    { sb: 5, bb: 10 },
    { sb: 8, bb: 16 },
    { sb: 12, bb: 25 },
    { sb: 20, bb: 40 },
    { sb: 30, bb: 60 },
    { sb: 50, bb: 100 },
    { sb: 75, bb: 150 },
    { sb: 100, bb: 200 },
    { sb: 150, bb: 300 },
    { sb: 300, bb: 600 },
  ],
  levelHands: 0,
  levelSeconds: 90,
  clockMs: 10_000,
  graceMs: 8_000,
};

/* Standard heads-up. The match this site started with: 200 units a seat, blinds
   1/2, best of 25 hands or bust, a twenty second clock. The 25 hand cap is
   what normally ends it, around the twenty minute mark.

   The ladder below is a backstop and nothing else. It climbs every 30 minutes,
   which is past the end of any match played at a normal pace, and it exists so
   that a match nobody is actually playing, two people letting the clock and
   the reconnect grace run on every decision, still cannot outlive two hours.

     level  blinds    starts at   table total in bb
       1     1/2        0:00           400
       2     5/10      30:00            40
       3     30/60     60:00             6.6
       4    200/400    90:00             1      <- top

   90:00 plus one forced hand. `levelHands` stays at 25, which is the whole
   match, so the hand basis never moves the blinds: only the clock does, and
   only when the clock has been abused. */
export const HEADS_UP_STANDARD: MatchFormat = {
  mode: 'heads-up',
  speed: 'standard',
  players: 2,
  rated: true,
  hands: 25,
  stack: 200,
  sb: 1,
  bb: 2,
  levels: [
    { sb: 1, bb: 2 },
    { sb: 5, bb: 10 },
    { sb: 30, bb: 60 },
    { sb: 200, bb: 400 },
  ],
  levelHands: 25,
  levelSeconds: 1_800,
  clockMs: 20_000,
  graceMs: 15_000,
};

/* Standard six-max. The sit-and-go this site started with: nine levels, eight
   hands each, last player standing. Three levels are added on the end and a
   time basis behind them, for the same reason as heads-up above: 50/100 left
   twelve big blinds on the table, which collapses a table but does not
   *prove* it ends.

     level  blinds    at hand   at time   table total in bb
       1     1/2         1       0:00         600
       2     2/4         9      10:00         300
       3     3/6        17      20:00         200
       4     5/10       25      30:00         120
       5     8/16       33      40:00          75
       6    12/24       41      50:00          50
       7    20/40       49      60:00          30
       8    30/60       57      70:00          20
       9    50/100      65      80:00          12
      10   100/200      73      90:00           6
      11   200/400      81     100:00           3
      12   400/800      89     110:00           1.5   <- top

   The level is whichever basis is further along. A table played at anything
   like a normal pace runs eight hands in well under ten minutes, so the hand
   basis leads the whole way and the clock never touches it. The clock only
   takes over on a table running slower than 75 seconds a hand, which is a
   table that is going to need the help. 110:00 plus five forced hands is
   110:50. */
export const SIX_MAX_STANDARD: MatchFormat = {
  mode: 'six-max',
  speed: 'standard',
  players: 6,
  rated: true,
  hands: null,
  stack: 200,
  sb: 1,
  bb: 2,
  levels: [
    { sb: 1, bb: 2 },
    { sb: 2, bb: 4 },
    { sb: 3, bb: 6 },
    { sb: 5, bb: 10 },
    { sb: 8, bb: 16 },
    { sb: 12, bb: 24 },
    { sb: 20, bb: 40 },
    { sb: 30, bb: 60 },
    { sb: 50, bb: 100 },
    { sb: 100, bb: 200 },
    { sb: 200, bb: 400 },
    { sb: 400, bb: 800 },
  ],
  levelHands: 8,
  levelSeconds: 600,
  clockMs: 20_000,
  graceMs: 15_000,
};

/* The standard formats under their original names, because that is what they are
   and half the site imports them to print the rules. */
export const HEADS_UP_FORMAT = HEADS_UP_STANDARD;
export const SIX_MAX_FORMAT = SIX_MAX_STANDARD;

/* How long a finished hand is held on screen before the next one deals, or
   before the match result is sent. The server sleeps it and the client counts
   it down, so it lives here rather than in either of them: two copies of this
   number drift and the countdown starts lying. Capped at the decision clock,
   so a test running a 300 ms clock does not spend four seconds a hand. */
export const HAND_HOLD_MS = 4_000;

/* The hold one format actually uses: its own `holdMs` if it set one, the
   shared default otherwise, and never longer than the decision clock. The
   server sleeps this and the client counts it down, so both ask here. */
export function holdFor(format: MatchFormat): number {
  return Math.min(format.holdMs ?? HAND_HOLD_MS, format.clockMs);
}

/* An all-in run-out: everybody still in the hand is all in, nobody has a
   decision left, and the streets that remain are dealt on their own beats
   with every live hand face up. Three ticks of a second each before the flop,
   the turn and the river, which is long enough to read two hole cards
   against a board and short enough that a table does not stall on a hand
   nobody can act in.

   One number, here, for the same reason HAND_HOLD_MS is: the server sleeps
   it and the client prints the count it produces. The count itself is on the
   wire (`TableView.runout`) rather than counted down twice. */
export const RUNOUT_TICKS = 3;
export const RUNOUT_TICK_MS = 1_000;

/* The tick one format actually uses: its own `runoutTickMs` if it set one,
   the shared default otherwise, and never long enough that one street's
   countdown outlasts a whole decision. That ceiling is the same bargain
   `holdFor` makes with `clockMs`: a table played on a 400 ms clock is a test
   or a ladder, and neither should spend nine seconds watching a board it has
   already dealt. Zero means no pacing at all. */
export function runoutTickFor(format: MatchFormat): number {
  return Math.min(format.runoutTickMs ?? RUNOUT_TICK_MS, Math.floor(format.clockMs / RUNOUT_TICKS));
}

/* A practice table does not deal on by itself the way `holdFor` above does:
   the finished hand stays up until the human sends `next`. This is the
   safety valve for the case where they never do (walked away, closed the
   tab): after this long the table deals on (or finishes the match) as if
   `next` had arrived, so a bot table cannot hang forever on somebody who
   isn't coming back. */
export const PRACTICE_HOLD_TIMEOUT_MS = 120_000;

/* The timeout one practice format actually uses: its own
   `practiceHoldTimeoutMs` if it set one, the shared default otherwise. */
export function practiceHoldTimeoutFor(format: MatchFormat): number {
  return format.practiceHoldTimeoutMs ?? PRACTICE_HOLD_TIMEOUT_MS;
}

/* Six handed is the main game. It is the one the home page opens on, the one
   a bare `queue` message means, and the one the site is about: a full ring is
   more poker than a duel, and heads-up is the sideshow beside it. Standard,
   because a default should be the ordinary game rather than the fast one. */
export const DEFAULT_FORMAT = SIX_MAX_STANDARD;
export const DEFAULT_MODE: Mode = 'six-max';
export const DEFAULT_SPEED: Speed = 'standard';

/* A bot's strategy is a **tier**, and a level is only where that tier currently
   sits on the ladder. The distinction earns its keep the moment the ladder is
   renumbered: everything that decides how a bot plays reads `LEVEL_TIER`, so
   moving a tier up or down the scale is an edit to one table and not a search
   for integer comparisons.

   Nothing may branch on the number. `LEVEL_TIER` is one-to-one on purpose:
   two levels sharing a tier is two levels playing identically, which the
   ordering test would rightly fail. */
export type BotTier = 'station' | 'loose' | 'tight' | 'solid' | 'sharp' | 'regular' | 'solver';

/* The seven bot levels, one table shared by the server (which plays them and
   labels the roster) and the client (which offers them in the practice
   picker). Level 4 is the bot that existed before levels did; 1 to 3 are
   progressively looser or more passive, 5 is sharper. 6 and 7 are a different
   animal: they track both ranges through the hand and solve the board in front
   of them, which costs real processor time, so there are two accounts each.
   Monotonic: a higher level beats a lower one over a long enough sample. */
export type BotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LEVEL_TIER: Record<BotLevel, BotTier> = {
  1: 'station',
  2: 'loose',
  3: 'tight',
  4: 'solid',
  5: 'sharp',
  6: 'regular',
  7: 'solver',
};

export function tierOf(level: BotLevel): BotTier {
  return LEVEL_TIER[level];
}

export const DEFAULT_BOT_LEVEL: BotLevel = 4;

export interface BotLevelInfo {
  level: BotLevel;
  tier: BotTier;
  name: string; // short label for a picker option
  description: string; // the one line shown beside a bot's name
}

export const BOT_LEVELS: BotLevelInfo[] = [
  { level: 1, tier: 'station', name: 'Loose and passive', description: 'Level 1: loose and passive, calls almost everything' },
  { level: 2, tier: 'loose', name: 'Loose', description: 'Level 2: loose, raises only with strong hands' },
  { level: 3, tier: 'tight', name: 'Tight and passive', description: 'Level 3: tight but rarely raises' },
  { level: 4, tier: 'solid', name: 'Solid', description: 'Level 4: solid, plays the charts and pot odds' },
  { level: 5, tier: 'sharp', name: 'Sharp', description: 'Level 5: sharp, semi-bluffs and sizes bets by the board' },
  {
    level: 6,
    tier: 'regular',
    name: 'Regular',
    description: 'Level 6: reads how you play and solves the river against it',
  },
  {
    level: 7,
    tier: 'solver',
    name: 'Solver',
    description: 'Level 7: tracks both ranges and solves the board while you wait',
  },
];

export function isBotLevel(n: unknown): n is BotLevel {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= BOT_LEVELS.length;
}

// Anything outside the range reads as the default rather than erroring: a level is
// a preference, and a stored or hand-typed one should not break a table.
export function botLevelInfo(level: number): BotLevelInfo {
  return BOT_LEVELS.find((b) => b.level === level) ?? BOT_LEVELS[DEFAULT_BOT_LEVEL - 1];
}

/* The home page's three quick presets, one table so the button row and the
   bots setup page cannot describe "hard" differently. When the level 6 bot
   lands, hard moves here and only here. */
export type PracticePreset = 'easy' | 'medium' | 'hard';

export const PRACTICE_PRESETS: Record<PracticePreset, BotLevel> = {
  easy: 2,
  medium: 4,
  hard: 5,
};

const FORMATS: Record<Mode, Record<Speed, MatchFormat>> = {
  'heads-up': { fast: HEADS_UP_FAST, standard: HEADS_UP_STANDARD },
  'six-max': { fast: SIX_MAX_FAST, standard: SIX_MAX_STANDARD },
};

export function formatFor(mode: Mode, rated: boolean, speed: Speed = DEFAULT_SPEED): MatchFormat {
  const base = FORMATS[mode === 'six-max' ? 'six-max' : 'heads-up'][speed === 'fast' ? 'fast' : 'standard'];
  return { ...base, rated };
}

/* Which level of the schedule is in play. Two bases, and the level is
   whichever is further along: hands, which is what six-max has always climbed
   on, and elapsed match time, which is what a short table climbs on and what
   keeps a long one inside its ceiling. A basis with a zero or missing setting
   contributes nothing rather than dividing by it, so a format from before
   speed existed reads exactly as it always did.

   `elapsedMs` is time since the match was created, which the server passes and
   a reader of a stored hand does not have. That is why a hand row records the
   blinds it was actually dealt at: see `server/db/schema.sql`. */
export function levelAt(format: MatchFormat, handNumber: number, elapsedMs = 0): number {
  if (format.levels.length <= 1) return 0;
  const byHands = format.levelHands > 0 ? Math.floor((handNumber - 1) / format.levelHands) : 0;
  const seconds = format.levelSeconds ?? 0;
  const byTime = seconds > 0 ? Math.floor(elapsedMs / 1_000 / seconds) : 0;
  return Math.min(format.levels.length - 1, Math.max(0, byHands, byTime));
}

export function blindsAt(format: MatchFormat, handNumber: number, elapsedMs = 0): { sb: number; bb: number } {
  if (format.levels.length <= 1) return { sb: format.sb, bb: format.bb };
  return format.levels[levelAt(format, handNumber, elapsedMs)];
}

/* ---------------------------------------------------------- ready check

   A matchmade table asks everybody at it to say they are there before it
   deals, the way a CS2 match does. It exists because a queue can hand you a
   table you walked away from four minutes ago, and five people then wait out
   a sit-out that a single click could have avoided.

   The numbers live here rather than on either side because the client counts
   down the same window the server enforces and the same cooldown it applies,
   and two copies of either drift until the countdown starts lying. */

export const READY_CHECK_MS = 20_000;

/* A no-show costs two minutes, and the cost doubles for every further no-show
   inside the hour, up to half an hour. It is not a punishment so much as a
   filter: somebody who has walked away is put behind everybody who has not,
   and the queue stops offering their seat to five other people. */
export const READY_COOLDOWN_MS = 2 * 60_000;
export const READY_COOLDOWN_WINDOW_MS = 60 * 60_000;
export const READY_COOLDOWN_MAX_MS = 30 * 60_000;

/* How long the nth no-show inside the window costs. n is 1-based, so the
   first is two minutes, the second four, the third eight, and it caps at
   thirty. Pure, so the client can print the same number the server set. */
export function readyCooldownMs(offences: number): number {
  if (offences < 1) return 0;
  return Math.min(READY_COOLDOWN_MAX_MS, READY_COOLDOWN_MS * 2 ** (offences - 1));
}

/* Why a ready check ended without a table. `declined` is somebody pressing
   no, `timeout` is somebody saying nothing at all; they read differently on
   screen and they cost the same. */
export type ReadyFailure = 'declined' | 'timeout';

/* The ready check as one shape in every state it can be in, so a client holds
   one object rather than reconciling four messages.

   - `pending`: the table has been gathered and is waiting on people.
   - `accepted`: somebody accepted, including you; `accepted` has moved.
   - `cancelled`: it will not start. `why` says which way it failed, and
     `requeued` is true for everybody who did accept, because they go back to
     the front of the queue rather than to the back of it. `cooldownUntil` is
     present only for the person who caused it.

   A table that everybody accepts sends no fourth state: the ordinary
   `q found` arrives instead, which is what every other path to a table sends
   and what every client already handles. */
export interface ReadyCheck {
  id: string;
  mode: Mode;
  speed: Speed;
  rated: boolean;
  seats: number; // seats at the table, bots included
  humans: number; // people who have to accept
  accepted: number;
  deadline: number; // epoch ms
}

/* --------------------------------------------------- walkouts and bans

   Leaving a ranked match early is a walkout, whether it is chosen (the
   table's leave control) or taken (three timeouts, or a connection that
   never came back). It costs the other player their game, so it costs the
   person who did it a spell out of ranked, and the spell grows with how
   often they do it.

   Unlike the ready check's cooldown, this one is persisted: a penalty that a
   deploy wipes is not a penalty, and a walkout is a decision about a match
   somebody was already in rather than a filter on a queue.

   Strikes decay at one a day of real time. There is no sweep and no cron:
   `walkoutStrikesNow` takes the count and the moment it was last written and
   subtracts the days since, which is the same answer a nightly job would
   reach and is true the instant it is asked.

   The ladder is here rather than on the server because the modal that warns
   somebody what leaving will cost has to name the same number the ban will
   be, and two copies of it drift until the warning starts lying. */

export const WALKOUT_DECAY_MS = 24 * 60 * 60 * 1000;

/* How long a ban lasts, by the number of strikes the player is carrying once
   this walkout has been counted. Index 0 and 1 are free: the first walkout is
   a bad evening, not a pattern. Everything from the fifth on is eight hours. */
export const WALKOUT_BAN_MS: readonly number[] = [
  0,
  0,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  8 * 60 * 60_000,
];

export function walkoutBanMs(strikes: number): number {
  if (!Number.isFinite(strikes) || strikes < 1) return 0;
  const i = Math.min(Math.floor(strikes), WALKOUT_BAN_MS.length - 1);
  return WALKOUT_BAN_MS[i];
}

/* Strikes as they stand now: the stored count less one for every whole day
   since it was written. `at` is null for somebody who has never walked out.
   Never negative, which is what makes the stored count safe to leave alone
   until the next walkout rewrites it. */
export function walkoutStrikesNow(strikes: number, at: number | null, now = Date.now()): number {
  if (!strikes || at === null) return 0;
  const decayed = Math.floor(Math.max(0, now - at) / WALKOUT_DECAY_MS);
  return Math.max(0, strikes - decayed);
}

/* A ban length in words, for the modal that warns about one and the refusal
   that enforces it. Whole units only: every rung of the ladder is one. */
export function banDurationText(ms: number): string {
  if (ms <= 0) return 'no ban';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/* How long is left of a ban, in words, for a line that says when somebody can
   play ranked again. Rounded up so it never reads "0 minutes" while the ban
   is still running. */
export function banRemainingText(until: number, now = Date.now()): string {
  const left = Math.max(0, until - now);
  if (left < 60_000) {
    const seconds = Math.max(1, Math.ceil(left / 1000));
    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/* What a refused ranked door says, and what the play panel says before
   anybody presses one. One sentence in one place, because the server's
   refusal and the client's disabled control are the same fact and two
   wordings of it read as two different rules. */
export function rankedBanText(until: number, now = Date.now()): string {
  return `You left a ranked match. Ranked opens again in ${banRemainingText(until, now)}.`;
}

/* ------------------------------------------------------------ the gate

   Rated play opens after one finished casual or practice match. One, not
   ten: it is there so nobody's first ever hand moves a rating they did not
   know they had, and so a bot farm has to play a match before it can touch
   the ladder. Counted over finished unrated matches, which is casual,
   practice and a casual home game alike. */
export const RANKED_GATE_MATCHES = 1;

/* ---------------------------------------------------------------- level

   Level is how many matches somebody has finished, and nothing else. It is
   not a skill claim, which is what the rating is for, and it unlocks nothing:
   the queue, the modes and the speeds are open to everybody from the first
   visit. It exists so that a profile says how much poker has been played on
   it, which a rating deliberately does not.

   Level L needs LEVEL_STEP * L * (L + 1) / 2 finished matches, so the steps
   are 1, 3, 6, 10, 15 ... and levels get further apart as they go: level 5 at
   15 matches, level 10 at 55, level 20 at 210. */
export const LEVEL_STEP = 1;

export function levelThreshold(level: number): number {
  if (level <= 0) return 0;
  return (LEVEL_STEP * level * (level + 1)) / 2;
}

/* The largest level whose threshold this many matches has reached. Zero for
   somebody who has finished none, which is a real state and reads as "no
   level yet" rather than as level 1. */
export function levelFor(matches: number): number {
  if (!Number.isFinite(matches) || matches < 1) return 0;
  return Math.floor((Math.sqrt((8 * matches) / LEVEL_STEP + 1) - 1) / 2);
}

/* Where somebody is between two levels, for the bar under the number. `into`
   and `span` are matches, so a progress bar is into/span and the line under
   it is "N matches to level L+1". */
export function levelProgress(matches: number): {
  level: number;
  into: number;
  span: number;
  toNext: number;
} {
  const level = levelFor(matches);
  const at = levelThreshold(level);
  const next = levelThreshold(level + 1);
  const played = Math.max(0, Math.floor(matches));
  return { level, into: played - at, span: next - at, toNext: next - played };
}

/* --------------------------------------------------------------- badges

   Six of them, derived from counters the profile already carries rather than
   awarded into a table. Nothing has to be written when one is earned, nothing
   can be out of date, and a badge is simply true or not true of a player when
   somebody looks. They unlock nothing either. */
export type BadgeId = 'first-game' | 'level-5' | 'level-10' | 'level-20' | 'hundred-hands' | 'six-max-win';

export interface BadgeInfo {
  id: BadgeId;
  name: string;
  description: string;
}

export const BADGES: BadgeInfo[] = [
  { id: 'first-game', name: 'First game', description: 'Finished a match' },
  { id: 'level-5', name: 'Level 5', description: 'Finished 15 matches' },
  { id: 'level-10', name: 'Level 10', description: 'Finished 55 matches' },
  { id: 'level-20', name: 'Level 20', description: 'Finished 210 matches' },
  { id: 'hundred-hands', name: 'Hundred hands', description: 'Played 100 hands' },
  { id: 'six-max-win', name: 'Took a table', description: 'Won a six handed match' },
];

/* Everything a badge is decided from. All three are counters the profile
   already prints somewhere else on the page. */
export interface BadgeStats {
  matches: number; // finished matches, every mode and both speeds
  hands: number; // hands dealt to this player
  sixMaxWins: number;
}

export function badgesFor(stats: BadgeStats): BadgeId[] {
  const level = levelFor(stats.matches);
  const earned: BadgeId[] = [];
  if (stats.matches >= 1) earned.push('first-game');
  if (level >= 5) earned.push('level-5');
  if (level >= 10) earned.push('level-10');
  if (level >= 20) earned.push('level-20');
  if (stats.hands >= 100) earned.push('hundred-hands');
  if (stats.sixMaxWins >= 1) earned.push('six-max-win');
  return earned;
}

/* A home game lobby: the private six-max table a host is gathering. The
   status is derived from the row's clock when it is read, so `expired` is a
   thing a lobby can be without anything having written it down. */
export type HomeGameStatus = 'open' | 'started' | 'cancelled' | 'expired';

/* One person sitting in a lobby. `uid` is what the avatar is drawn from, so
   a seat carries everything the ring needs and nothing more. */
export interface LobbySeat {
  uid: string;
  name: string;
  rating: number; // their six-max standing, the mode a home game is played in
  host: boolean;
  avatarV?: number; // picture version, 0 for none
  country?: string; // see SeatView.country
}

/* An arena: a half-hour heads-up event that pairs you again the moment your
   match ends. Three statuses and no more: it is upcoming until its clock
   starts, running until its clock ends, and finished for good after that. */
export type ArenaStatus = 'upcoming' | 'running' | 'finished';

/* One row of an arena's board. Everything the standings table draws, so a row
   never needs a second lookup: `rank` is the server's ordering (score, then
   wins, then rating) rather than the row's index, because a page shows the top
   twenty plus you and you may be neither. */
export interface ArenaStanding {
  uid: string;
  name: string;
  bot: boolean;
  rating: number; // heads-up standing, the mode an arena is played in
  rank: number; // 1-based
  score: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number; // consecutive wins; two of them and the next win is worth three
  matches: number;
  paused: boolean;
  avatarV?: number; // picture version, 0 for none
  country?: string; // see SeatView.country
}

/* What a result is worth on the board, and when a run of wins starts paying
   more. Here rather than in the server that applies it, because the client
   draws the flame that promises the next win is worth three and two copies of
   that threshold drift until the promise stops being true. */
export const ARENA_WIN_POINTS = 2;
export const ARENA_DRAW_POINTS = 1;
export const ARENA_LOSS_POINTS = 0;
export const ARENA_FIRE_POINTS = 3;
// Wins in a row already banked before a win pays ARENA_FIRE_POINTS. Two, so
// the third consecutive win is the first one worth three.
export const ARENA_FIRE_FROM = 2;

export function arenaPoints(outcome: 'win' | 'loss' | 'draw', streakBefore: number): number {
  if (outcome === 'draw') return ARENA_DRAW_POINTS;
  if (outcome === 'loss') return ARENA_LOSS_POINTS;
  return streakBefore >= ARENA_FIRE_FROM ? ARENA_FIRE_POINTS : ARENA_WIN_POINTS;
}

/* Client -> server */
export type ClientMsg =
  // defaults: six-max, long, rated. `bots` asks for a practice table instead:
  // no human queue, seats filled from the roster at that level, never rated.
  | { t: 'queue'; mode?: Mode; rated?: boolean; speed?: Speed; bots?: { level: number } }
  | { t: 'dequeue' }
  // Accept or decline the table the ready check is offering. Sent without an
  // id: a player is only ever offered one table at a time, and the server
  // knows which.
  | { t: 'ready'; a: boolean }
  | { t: 'join'; m: string } // subscribe to a match as player or spectator
  // Unsubscribe. This is the page going away, nothing more: a match is not
  // abandoned by closing a tab, and the disconnect grace is what covers
  // somebody who has actually gone. Leaving the GAME is `resign`.
  | { t: 'leave'; m: string }
  // Leave the game on purpose, from the table's own control. Separate from
  // `leave` because `leave` is sent on every unmount, and a route change
  // must never forfeit a match somebody is still playing. What it costs
  // depends on the table: see server/src/match/CLAUDE.md.
  | { t: 'resign'; m: string }
  | { t: 'act'; m: string; h: number; n: number; a: ActionKind; v?: number } // n = action seq the client is acting at
  // Practice only: deal the next hand (or, on the last one, finish the
  // match) instead of waiting out the hold. `h` is the hand this is answering
  // for, echoed the same way `act` echoes `n`: a `next` for a hand that has
  // already moved on is ignored rather than misapplied to the one after it.
  // Sent by the human seat only; a spectator's or a bot's is ignored too, and
  // so is one on a table that never holds for it in the first place.
  | { t: 'next'; m: string; h: number }
  // Multiway only: I am back. Clears a sat-out seat and its timeout streak
  // without acting, which is the whole point of it being its own message: a
  // sat-out seat is auto check-folded the moment the action reaches it while
  // its player is away, so acting is not a way back that can be timed. The
  // room ignores one from a seat that is not sitting out, so it can neither
  // reset a streak for free nor duck a heads-up forfeit.
  | { t: 'back'; m: string }
  // Table chat. Anyone subscribed to the match may send one; where it lands is
  // the server's decision, not the sender's (see ChatFrom).
  | { t: 'chat'; m: string; text: string }
  // Watch one arena's board, or `null` to stop. A page on the arena is what
  // the pushes go to, and that is a thing only the page knows, so it says so
  // rather than the server guessing from who joined.
  | { t: 'arena'; a: string | null }
  | { t: 'ping' };

/* Who said something at a table. `seat` is null for a spectator, which is also
   what says which channel the message belongs to: a spectator's line is only
   ever sent to other spectators, the way it works on Lichess, so a table
   cannot be coached from the rail. */
export interface ChatFrom {
  id: string;
  name: string;
  bot: boolean;
  seat: number | null;
  avatarV?: number; // picture version, 0 for none
}

/* The limits, here rather than on either side of the wire, because the client
   counts the same cooldown down that the server enforces and two copies of
   these numbers drift until the countdown starts lying. */
export const CHAT_MAX_LENGTH = 200;
export const CHAT_MIN_GAP_MS = 2_000; // one message per this long
export const CHAT_MAX_PER_MATCH = 20; // per user, for the life of the match
export const CHAT_HISTORY = 100; // kept in memory per channel, replayed on join

/* Server -> client */
export type ServerMsg =
  | { t: 'hi'; v: number; u: UserSummary }
  | {
      t: 'q';
      s: 'searching' | 'found' | 'left';
      w?: number;
      range?: number;
      m?: string;
      mode?: Mode;
      rated?: boolean;
      speed?: Speed;
      seated?: number; // players gathered so far for a multiway table
    }
  // The ready check, in whichever state it is in. See ReadyCheck above for
  // what each state means and why an accepted one sends `q found` rather
  // than a fourth state of its own.
  | ({ t: 'ready'; s: 'pending' | 'accepted' | 'cancelled'; why?: ReadyFailure; requeued?: boolean; cooldownUntil?: number } & ReadyCheck)
  | { t: 'state'; s: TableView }
  | { t: 'end'; m: string; r: MatchResult }
  // Who is sitting in a home game lobby, pushed to everyone seated in it so
  // the lobby page updates without polling for it.
  | { t: 'lobby'; g: string; seats: LobbySeat[]; status: HomeGameStatus }
  | { t: 'chat'; m: string; from: ChatFrom; text: string; at: number } // at = epoch ms
  // An arena's board, pushed to everyone watching it on a five second beat and
  // on every score change. `standings` is the top twenty plus you.
  | {
      t: 'arena';
      a: string;
      standings: ArenaStanding[];
      you: ArenaStanding | null;
      status: ArenaStatus;
      endsAt: number; // epoch ms
      playing: number; // arena matches in progress
    }
  | {
      t: 'err';
      // `ranked_locked` is the one refusal that is not about this request
      // being wrong: rated play opens after one finished casual match, and
      // the message says so. `cooldown` is a ready check no-show serving out
      // the wait they earned, and `ranked_ban` is a walkout serving out
      // theirs (see WALKOUT_BAN_MS below).
      c:
        | 'illegal'
        | 'stale'
        | 'not_your_turn'
        | 'no_match'
        | 'bad_msg'
        | 'version'
        | 'bots_busy'
        | 'chat'
        | 'ranked_locked'
        | 'cooldown'
        | 'ranked_ban';
      msg: string;
    }
  | { t: 'pong' };

/* One mode's Glicko-2 standing. Ratings are per mode, the way a chess site
   keeps bullet and blitz apart: a six-max result never moves a heads-up
   rating. A player who has not played a mode reads as a fresh 1500/350. */
export interface ModeRating {
  rating: number;
  rd: number;
  provisional: boolean;
  peak: number;
  peakAt: string | null; // ISO, null until the mode has been played
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface UserSummary {
  id: string;
  name: string;
  guest: boolean;
  bot: boolean;
  botLevel?: number; // 1..7, present only on a bot
  /* The flag beside their name, as SeatView.country, except that this one is
     sent as `null` rather than left off when there is none: a summary is
     merged over the one a client already holds, and a key that goes absent
     when a flag is cleared would leave the old flag on the screen. Optional
     only so a v4 server, which sends no key at all, still parses. */
  country?: string | null;
  // Flat fields are the heads-up standing, kept so anything reading a single
  // rating still works. `ratings` is the real answer.
  rating: number;
  rd: number;
  provisional: boolean;
  ratings: Record<Mode, ModeRating>;
  /* Which version of this player's picture to ask for, 0 when they have none.
     Optional so a client talking to a server that predates pictures reads the
     generated avatar rather than a broken image. */
  avatarV?: number;
}

export interface LastEvent {
  k: 'deal' | 'act' | 'street' | 'showdown' | 'award' | 'newhand' | 'timeout';
  seat?: number;
  a?: ActionKind;
  v?: number;
  cards?: Card[];
}

export interface SeatView {
  i: number;
  uid: string;
  name: string;
  /* The flag beside the name: a lowercase ISO 3166-1 alpha-2 code the player
     picked for themselves, absent when they have picked none. Optional, and
     omitted rather than sent as null, because most players will never set one
     and a v4 client is served a seat it can already read. Snapshotted with the
     name when the match is created, so changing it mid-match changes the next
     table rather than this one. */
  country?: string;
  rating: number;
  stack: number;
  bet: number; // committed on the current street
  cards: Card[] | null; // null = no cards; ['?', '?'] = hidden from this viewer
  folded: boolean;
  allin: boolean;
  button: boolean;
  acting: boolean;
  connected: boolean;
  bot: boolean;
  out: boolean; // eliminated from a multiway match, seat stays visible with its place
  place: number | null; // finishing position once out (1 = winner), null while in
  /* Sat out after three consecutive timeouts on a multiway table: still
     dealt in and still posting blinds, but check-folded on arrival while
     their player is away. Additive and absent rather than false, because
     almost every seat in almost every hand is not sitting out. `back` (or
     any action) clears it. */
  sittingOut?: boolean;
  last: { a: ActionKind; v?: number } | null;
  /* Picture version, 0 for none. Frozen when the match was created, like the
     name and the rating beside it: a seat is what the table looked like when
     it sat down. */
  avatarV?: number;
}

export interface LegalActions {
  actions: ActionKind[];
  call: number; // amount to call (0 when check is legal)
  min: number; // minimum bet/raise-to amount
  max: number; // maximum bet/raise-to (all-in)
}

export interface TableView {
  m: string; // match id
  h: number; // hand number, 1-based
  n: number; // action seq within the hand; act messages must echo it
  street: Street;
  board: Card[];
  pot: number; // total in the middle including current-street bets
  pots: { amount: number; seats: number[] }[]; // main and side pots once settled
  seats: SeatView[];
  you: number | null; // your seat index, null when spectating
  legal: LegalActions | null; // non-null only when it is your turn
  clock: { seat: number; deadline: number; paused: boolean } | null; // deadline = epoch ms
  seedHash: string;
  seed: string | null; // published when the hand completes
  format: MatchFormat;
  blinds: { sb: number; bb: number }; // current level
  /* Which level of the schedule those blinds are, 0-based. Additive, and the
     server is the only thing that can work it out: a short format climbs on
     elapsed match time, which nothing but the room knows. A client that does
     not get one falls back to counting hands, which is what it always did and
     what is still right for every long format. */
  level?: number;
  handsPlayed: number;
  last: LastEvent | null;
  result: HandResult | null; // set while street === 'done'
  /* Present only in the hand-over state of a practice table, for the human
     viewer: the table has finished a hand and is waiting for them to send
     `next` rather than dealing on by itself. Additive and optional, absent
     everywhere else (a non-practice table, a spectator, mid-hand). */
  hold?: 'you';
  /* The countdown to the next street of an all-in run-out: which street is
     coming and how many ticks are left before it lands. Present on every
     viewer's view, only while a run-out is being paced and only between the
     streets, never on the beat one arrives. While it is here the hand is
     decided but not shown: `street` and `board` say how much of the run-out
     the table has seen, the live hands are already face up in `seats`, and
     `result` is still null. Additive and optional. */
  runout?: { next: Street; in: number };
}

export interface HandResult {
  awards: { seat: number; amount: number; hand?: string }[]; // hand = description when shown down
  shown: Record<number, Card[]>; // hole cards revealed at showdown, keyed by seat
}

export interface MatchResult {
  winner: string | null; // user id, null on draw
  /* `forfeit` is the clock taking a match off somebody who stopped
     answering; `left` is the same ending chosen on purpose, and they are
     told apart because the result panel reads differently for each. */
  reason: 'bust' | 'hands' | 'forfeit' | 'draw' | 'abort' | 'left';
  stacks: Record<string, number>;
  places: Record<string, number>; // finishing position per user id, 1 = winner; heads-up draw gives both 1
  rated: boolean;
  ratings: Record<string, { before: number; after: number; rdBefore: number; rdAfter: number }>;
}

/* Persisted action log entry: with the seed and format it reconstructs the hand. */
export interface LoggedAction {
  s: number; // seat
  a: ActionKind;
  v?: number; // amount for b/r (raise-to), omitted otherwise
  t: number; // ms since hand start
  to?: boolean; // true when the action was applied by the clock, not the player
}

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m.t !== 'string') return null;
    return m as ClientMsg;
  } catch {
    return null;
  }
}
