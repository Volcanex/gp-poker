import {
  READY_CHECK_MS,
  TOURNAMENT_MIN_FIELD,
  type MatchFormat,
  type Mode,
  type TournamentBoard,
  type TournamentEntrant,
  type TournamentRef,
  type TournamentSeat,
  type TournamentShape,
  type TournamentStatus,
  type TournamentTable,
} from '@opentable/protocol';
import { config, shownAsBot } from '../config.js';
import {
  countTournamentPlayers,
  countSettledTournaments,
  deleteTournamentPlayer,
  ensureTournament,
  finishTournament,
  finishTournamentTable,
  getOpenTournaments,
  getSettledTournaments,
  getTournamentById,
  getTournamentPlayers,
  getTournamentTables,
  getTournamentTablesForRound,
  getUpcomingTournament,
  getUserById,
  insertTournamentPlayer,
  insertTournamentTables,
  isTournamentPlayer,
  setTournamentOutRound,
  setTournamentRound,
  setTournamentSeeds,
  setTournamentStatus,
  setTournamentTableMatch,
  withdrawTournamentPlayer,
  type TournamentPlayerRow,
  type TournamentRow,
  type TournamentTableRow,
} from '../db.js';
import { openReadyCheck } from '../ready.js';
import { createMatchForPlayers, matchFormat, randomMatchId, rankedUnlocked } from '../matchmaking.js';
import { rankedBanMessage, rankedBanUntil } from '../walkouts.js';
import { onMatchFinished } from '../match/finished.js';
import { hub } from '../ws/hub.js';
import { vacateFor } from '../vacate.js';
import { advanceCount, bracketFirstRound, shootoutTables, snakeSeats, placeForRound } from './draw.js';
import { FIXTURES, fixtureFor, nextStartAfter, type TournamentFixture } from './fixtures.js';

/* Tournaments: the arena's sibling.

   An arena is a rolling pairing with a running score. A tournament is a field
   that funnels: a heads-up bracket down to one, or six-max tables playing down
   to a final table. Three fixtures on a fixed calendar
   (`fixtures.ts`), no admin, and at most three upcoming at once because the
   scheduler creates each fixture's next row as soon as the previous one
   starts.

   It is background work on a timer, so it obeys the arena's two rules.
   Nothing may throw out of a tick: this runs from a timer nobody awaits and a
   rejection would take every live match with it. And everything a test needs
   to drive is an injectable seam rather than a wall clock: the clock, the
   match format and the ready window are all injected, and `tournamentTick` is
   one pass, exported the way `arenaTick` is, so a whole tournament plays out
   in a suite in a few assignments.

   A tournament match is an ordinary match. `format.tournament` carries the id,
   the round and the table and is the only thing that makes it one: the same
   `createMatchForPlayers`, the same public page, the same Glicko-2 where the
   table is rated. */

// The scheduler's beat. Slower than the arena's, because a tournament changes
// on events (a table settling, a round starting) rather than continuously, and
// the finished-match listener is what makes those changes immediate.
const TICK_MS = 5_000;

// How many bots the population registers is the fixture's business; how far
// ahead it may do it is this. One hour, so a fixture fills up shortly before
// it is played rather than a day early with a field nobody chose.
export const BOT_REGISTRATION_WINDOW_MS = 60 * 60 * 1000;

// The results list's page size, shared by the route and the client's paging.
export const TOURNAMENT_PAGE = 10;

export interface TournamentOptions {
  enabled?: boolean;
  // The clock. A suite runs a whole tournament against a fake now, which is
  // the only way to watch a fixture open, play its rounds and finish.
  now?: () => number;
  /* The format a tournament match is played on, the same seam the arena's is.
     `seats` is how many chairs this particular table has, which for a
     shootout is not always six. */
  format?: (mode: Mode, rated: boolean, seats: number, ref: TournamentRef) => MatchFormat;
  // How long a round's ready check runs. A suite shrinks it rather than
  // waiting twenty real seconds to prove a walkover.
  readyMs?: number;
  // The calendar itself, so a suite can run one fixture rather than three.
  fixtures?: TournamentFixture[];
}

/* Speed is fast for every tournament match, which is what bounds a round: the
   twenty minute ceiling means a round of a bracket cannot run away with the
   evening. `players` is the table's own seat count, because a balanced
   shootout table is often four or five rather than six. */
export function defaultTournamentFormat(mode: Mode, rated: boolean, seats: number, ref: TournamentRef): MatchFormat {
  return { ...matchFormat(mode, rated, 'fast'), players: seats, tournament: ref };
}

let enabled = config.tournamentsEnabled;
let now = () => Date.now();
let tournamentFormat = defaultTournamentFormat;
let readyMs = READY_CHECK_MS;
let fixtures = FIXTURES;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/* Who is looking at which tournament, exactly as the arena keeps it: a page
   says which board it is showing and the pushes go there. */
const watchers = new Map<string, Set<string>>(); // tournament id -> user ids
const watching = new Map<string, string>(); // user id -> tournament id

/* Tournaments being settled right now. A round is settled by whichever gets
   there first, the finished-match listener or the tick, and this is what stops
   both of them starting the next round. */
const settling = new Set<string>();

export function configureTournaments(opts: TournamentOptions): void {
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (opts.now !== undefined) now = opts.now;
  if (opts.format !== undefined) tournamentFormat = opts.format;
  if (opts.readyMs !== undefined) readyMs = opts.readyMs;
  if (opts.fixtures !== undefined) fixtures = opts.fixtures;
}

// Back to the configured defaults with nothing in flight, so a suite that has
// finished with tournaments does not leave the next file inheriting its clock.
export function resetTournaments(): void {
  stopTournaments();
  enabled = config.tournamentsEnabled;
  now = () => Date.now();
  tournamentFormat = defaultTournamentFormat;
  readyMs = READY_CHECK_MS;
  fixtures = FIXTURES;
  watchers.clear();
  watching.clear();
  settling.clear();
}

export function startTournaments(): void {
  if (timer || !enabled) return;
  timer = setInterval(() => {
    void tournamentTick();
  }, TICK_MS);
}

export function stopTournaments(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/* ------------------------------------------------------------- the schedule */

/* Keeps one upcoming row per fixture, which is what "at most three upcoming
   and never zero" means. A fixture whose row has started (or been cancelled)
   has no upcoming row, so the next one is written here on the very next pass:
   registration for the next daily opens the moment today's begins. */
async function ensureSchedule(): Promise<void> {
  const at = now();
  for (const fixture of fixtures) {
    if (await getUpcomingTournament(fixture.kind)) continue;
    await ensureTournament({
      id: randomMatchId(),
      kind: fixture.kind,
      shape: fixture.shape,
      mode: fixture.mode,
      name: fixture.name,
      seats: fixture.seats,
      startsAt: new Date(nextStartAfter(fixture.kind, at)),
    });
  }
}

/* --------------------------------------------------------------- the start */

/* Seeding: by the mode's rating at the start, strongest first, and the row
   that registered earliest breaks a tie. `getTournamentPlayers` already
   returns the field in that order before a seeding exists, so this is a
   numbering rather than a sort. */
function seedField(players: TournamentPlayerRow[]): { userId: string; seed: number; rating: number }[] {
  return players.map((p, i) => ({ userId: p.userId, seed: i + 1, rating: p.rating }));
}

/* A fixture's start. Registration closes here, the field is seeded, and the
   first round's tables are written and dealt.

   A field under the shape's minimum is cancelled rather than played. Four is
   the smallest bracket worth calling one and six is a single six-max table,
   and a tournament whose winner beat nobody is worse than a tournament that
   says nobody came. */
async function beginTournament(t: TournamentRow): Promise<void> {
  const players = await getTournamentPlayers(t.id);
  const minimum = TOURNAMENT_MIN_FIELD[t.shape];
  if (players.length < minimum) {
    await setTournamentStatus(t.id, 'cancelled', 0);
    await pushTournament(t.id);
    return;
  }

  await setTournamentSeeds(t.id, seedField(players));
  await setTournamentStatus(t.id, 'running', 1);
  await startRound({ ...t, status: 'running', round: 1 }, 1);
  // A first round that settled itself (every table a bye) moves on in the
  // same pass rather than waiting for the next tick.
  await settleTournament(t.id);
}

/* ---------------------------------------------------------------- a round */

// The user ids of a round's field, in seed order.
function inSeedOrder(players: TournamentPlayerRow[], ids: string[]): string[] {
  const seedOf = new Map(players.map((p) => [p.userId, p.seed ?? Number.MAX_SAFE_INTEGER]));
  return [...ids].sort((a, b) => (seedOf.get(a) ?? 0) - (seedOf.get(b) ?? 0));
}

/* The tables of a round. Round one comes from the draw; every round after it
   comes from the round before.

   A bracket's later rounds are **positional**: the winners of tables 2j and
   2j+1 meet at table j, which is what makes a bracket a bracket rather than a
   fresh pairing each round. A shootout's are **re-seeded**: the survivors are
   snaked across the new tables by seed, so the strong seeds are spread rather
   than collected. */
async function tablesForRound(
  t: TournamentRow,
  round: number,
  players: TournamentPlayerRow[]
): Promise<{ tableNo: number; seats: string[] }[]> {
  if (round === 1) {
    const seeded = players
      .filter((p) => p.seed !== null)
      .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
    const bySeed = new Map(seeded.map((p) => [p.seed as number, p.userId]));
    if (t.shape === 'bracket') {
      return bracketFirstRound(seeded.length).map((seats, tableNo) => ({
        tableNo,
        seats: seats.map((seed) => bySeed.get(seed) as string),
      }));
    }
    const sizes = shootoutTables(seeded.length);
    return snakeSeats(
      seeded.map((p) => p.userId),
      sizes
    ).map((seats, tableNo) => ({ tableNo, seats }));
  }

  const previous = await getTournamentTablesForRound(t.id, round - 1);
  if (t.shape === 'bracket') {
    const tables: { tableNo: number; seats: string[] }[] = [];
    for (let j = 0; j * 2 < previous.length; j++) {
      const seats = [...(previous[j * 2]?.advanced ?? []), ...(previous[j * 2 + 1]?.advanced ?? [])];
      tables.push({ tableNo: j, seats });
    }
    return tables;
  }
  const survivors = inSeedOrder(players, previous.flatMap((p) => p.advanced ?? []));
  const sizes = shootoutTables(survivors.length);
  return snakeSeats(survivors, sizes).map((seats, tableNo) => ({ tableNo, seats }));
}

/* Writes a round and deals every table in it. The round number is on the
   tournament row before the tables exist, so a tick arriving between the two
   sees a round with no tables and does nothing rather than settling it. */
async function startRound(t: TournamentRow, round: number): Promise<void> {
  const players = await getTournamentPlayers(t.id);
  const tables = await tablesForRound(t, round, players);
  await setTournamentRound(t.id, round);
  await insertTournamentTables(t.id, round, tables);
  await pushTournament(t.id);
  for (const table of tables) {
    await dealTable(t, round, table.tableNo, true);
  }
}

/* How many of a table go through. A bracket's table sends its winner; a
   shootout's sends the top two, or the top three where two tables make a
   six-handed final, or nobody at all because it is the final. */
function advanceFor(shape: TournamentShape, tablesInRound: number): number {
  return shape === 'bracket' ? (tablesInRound > 1 ? 1 : 0) : advanceCount(tablesInRound);
}

async function isBot(userId: string): Promise<boolean> {
  return (await getUserById(userId))?.bot === true;
}

/* One table, from a list of seats to a match being played.

   Three of the four outcomes never deal a hand. No seats at all is a table
   whose feeders sent nobody, one seat is a bye (a bracket's odd seat) or a
   walkover (an opponent who did not answer), and both settle the table the
   moment it is written. Only two or more seats is a match.

   `check` is false on a replay: a drawn heads-up match is replayed at once,
   and asking two people who have just played twenty-five hands whether they
   are still there would be asking a question they have already answered. */
async function dealTable(t: TournamentRow, round: number, tableNo: number, check: boolean): Promise<void> {
  const tables = await getTournamentTablesForRound(t.id, round);
  const row = tables.find((r) => r.tableNo === tableNo);
  if (!row || row.status === 'done') return;
  const seats = row.seats;
  const advance = advanceFor(t.shape, tables.length);

  if (seats.length === 0) {
    await finishTournamentTable(t.id, round, tableNo, { places: {}, advanced: [], bye: true });
    return;
  }
  if (seats.length === 1) {
    await finishTournamentTable(t.id, round, tableNo, {
      places: { [seats[0]]: 1 },
      advanced: advance > 0 ? [seats[0]] : [],
      bye: true,
    });
    return;
  }

  const bots = await Promise.all(seats.map(isBot));
  const humans = seats.filter((_, i) => !bots[i]);
  const ref: TournamentRef = { id: t.id, round, table: tableNo };

  const deal = async (playing: string[]) => {
    if (playing.length < 2) {
      await finishTournamentTable(t.id, round, tableNo, {
        places: playing.length === 1 ? { [playing[0]]: 1 } : {},
        advanced: playing.length === 1 && advance > 0 ? [playing[0]] : [],
        bye: true,
      });
      await pushTournament(t.id);
      return;
    }
    /* Heads-up tournament matches are rated, like an arena's. A six-max table
       is rated only with two or more people at it, which is the home game's
       rule and the same reason: five bots of a strength nobody chose is a
       rating anybody could dial in. */
    const playingHumans = playing.filter((id) => humans.includes(id));
    const rated = t.mode === 'heads-up' ? true : playingHumans.length >= 2;
    /* A tournament table outranks whatever a seat was doing alone, the way a
       friend's table does: a seat sitting in the queue or at a table with only
       bots at it is pulled out of it, no walkout charged, since no person is
       left waiting. One seat at a time rather than the whole table at once,
       because `vacateFor` refuses the lot when any one of them is in a match
       with another person, and a tournament cannot wait on somebody else's
       game: that seat is simply dealt in beside it. */
    for (const id of playing) {
      await vacateFor([id], id).catch(() => ({ ok: false as const }));
    }
    const matchId = await createMatchForPlayers(playing, tournamentFormat(t.mode, rated, playing.length, ref));
    await setTournamentTableMatch(t.id, round, tableNo, matchId);
    await pushTournament(t.id);
  };

  if (!check || humans.length === 0) {
    await deal(seats);
    return;
  }

  const opened = openReadyCheck({
    id: randomMatchId(),
    format: tournamentFormat(t.mode, t.mode === 'heads-up', seats.length, ref),
    seats: seats.length,
    humans,
    windowMs: readyMs,
    start: () => deal(seats),
    /* Silence or a decline withdraws that player from the tournament, and it
       costs them nothing else: there is no walkout to charge, because nobody
       is left waiting at a table that has not been dealt. Their opponent gets
       a walkover, a six-max table plays on without them, and a table left
       with one player advances that player with no hand dealt. */
    onCancel: (failed) => {
      void (async () => {
        for (const uid of failed) await withdrawTournamentPlayer(t.id, uid, round);
        await deal(seats.filter((id) => !failed.includes(id)));
        // A walkover can be the last table of the round, and nothing else
        // would notice until the next tick.
        await settleTournament(t.id);
      })().catch((err) => console.error(`tournament ${t.id} could not settle a failed check:`, err));
    },
  });
  if (!opened) await deal(seats);
}

/* -------------------------------------------------------------- settling */

/* A finished match onto its table. A bracket's winner goes through; a
   **drawn** heads-up match is replayed at once, because a bracket cannot
   advance two players and equal stacks after twenty-five hands is not a
   result. A shootout table's places are the elimination order the match
   already recorded, and the top two or three of them go through. */
async function recordTable(ref: TournamentRef, places: Record<string, number>, winner: string | null): Promise<void> {
  const t = await getTournamentById(ref.id);
  if (!t || t.status !== 'running') return;
  const tables = await getTournamentTablesForRound(t.id, ref.round);
  const row = tables.find((r) => r.tableNo === ref.table);
  if (!row || row.status === 'done') return;
  const advance = advanceFor(t.shape, tables.length);

  if (t.shape === 'bracket' && winner === null) {
    await dealTable(t, ref.round, ref.table, false);
    return;
  }

  const order = Object.entries(places)
    .sort((a, b) => a[1] - b[1])
    .map(([uid]) => uid);
  const advanced = order.slice(0, advance);
  if (!(await finishTournamentTable(t.id, ref.round, ref.table, { places, advanced, bye: false }))) return;
  await settleTournament(t.id);
}

/* A round is over when every table in it is done, and then the next one
   starts. Called by the finished-match listener, so a round begins the moment
   the last match of the previous one settles, and by the tick, which is the
   safety net and the test seam. `settling` is what stops the two of them
   doing it twice. */
export async function settleTournament(id: string): Promise<void> {
  if (settling.has(id)) return;
  settling.add(id);
  try {
    /* Round by round rather than one round a call. A round every table of
       which was a bye (a bracket where nobody answered their check) is over
       the moment it is written, so the next one has to start in the same
       pass; the bound is a guard against a shape that stopped funnelling,
       which would otherwise be an infinite loop inside a tick. */
    for (let pass = 0; pass < 64; pass++) {
      const t = await getTournamentById(id);
      if (!t || t.status !== 'running' || t.round < 1) return;
      const tables = await getTournamentTablesForRound(id, t.round);
      if (tables.length === 0) return;
      if (!tables.every((r) => r.status === 'done')) return;

      const advanced = tables.flatMap((r) => r.advanced ?? []);
      await setTournamentOutRound(
        id,
        tables.flatMap((r) => r.seats).filter((uid) => !advanced.includes(uid)),
        t.round
      );

      // One table is the final, whichever shape it is: a bracket's last round
      // holds one match and a shootout funnels down to one table.
      if (tables.length === 1) {
        await finishTournamentRun(t, tables[0]);
        await pushTournament(id);
        return;
      }
      await startRound(t, t.round + 1);
    }
  } catch (err) {
    console.error(`tournament ${id} could not be settled:`, err);
  } finally {
    settling.delete(id);
  }
}

/* Every place, and the podium. The final table's own places are the top of
   the sheet; everybody else is placed by the round they went out in, tied
   within it, which is one past however many players were still in after that
   round.

   A player who withdrew at the final's ready check is placed under everybody
   who actually sat down, which is why the final round's survivor count is the
   size of the final table's result rather than the number that advanced into
   it (nobody advances out of a final). */
async function finishTournamentRun(t: TournamentRow, final: TournamentTableRow): Promise<void> {
  const finalPlaces = final.places ?? {};
  const allTables = await getTournamentTables(t.id);
  const players = await getTournamentPlayers(t.id);

  const survivors = new Map<number, number>();
  for (let round = 1; round <= t.round; round++) {
    const inRound = allTables.filter((r) => r.round === round);
    survivors.set(
      round,
      round === t.round
        ? Object.keys(finalPlaces).length
        : inRound.reduce((sum, r) => sum + (r.advanced?.length ?? 0), 0)
    );
  }

  const places: { userId: string; place: number }[] = [];
  for (const p of players) {
    const own = finalPlaces[p.userId];
    if (own !== undefined) {
      places.push({ userId: p.userId, place: own });
      continue;
    }
    const round = p.outRound ?? t.round;
    places.push({ userId: p.userId, place: placeForRound(survivors.get(round) ?? 0) });
  }

  const byPlace = new Map(places.map((p) => [p.userId, p.place]));
  const podium = players
    .filter((p) => (byPlace.get(p.userId) ?? 99) <= 3)
    .sort((a, b) => (byPlace.get(a.userId) ?? 0) - (byPlace.get(b.userId) ?? 0))
    .map((p) => ({ uid: p.userId, avatarV: p.avatarV, name: p.name, place: byPlace.get(p.userId) as number }))
    // Three, the way an arena's podium is three, even where a tie at third
    // means four people share the step.
    .slice(0, 3);

  await finishTournament(t.id, places, podium);
}

/* Registered once, at import: a tournament is a listener on "a match
   finished" rather than something a match room knows about, exactly as the
   arena is. See match/finished.ts. */
onMatchFinished(async (match) => {
  const ref = match.format.tournament;
  if (!ref) return;
  await recordTable(ref, match.places, match.winner);
});

/* ------------------------------------------------------------------ views */

function entrantOf(p: TournamentPlayerRow): TournamentEntrant {
  return {
    uid: p.userId,
    name: p.name,
    bot: shownAsBot(p.bot),
    rating: Math.round(p.rating),
    seed: p.seed,
    place: p.place,
    outRound: p.outRound,
    withdrawn: p.withdrawn,
    avatarV: p.avatarV,
    ...(p.country ? { country: p.country } : {}),
  };
}

function seatOf(p: TournamentPlayerRow, table: TournamentTableRow): TournamentSeat {
  const place = table.places?.[p.userId] ?? null;
  return {
    uid: p.userId,
    name: p.name,
    bot: shownAsBot(p.bot),
    seed: p.seed ?? 0,
    rating: Math.round(p.rating),
    place,
    advanced: (table.advanced ?? []).includes(p.userId),
    avatarV: p.avatarV,
    ...(p.country ? { country: p.country } : {}),
  };
}

/* The rounds as the bracket's columns and the funnel's bands. A seat carries
   everything it is drawn with, so neither drawing needs a second lookup into
   the entrant list. */
function roundsOf(
  t: TournamentRow,
  tables: TournamentTableRow[],
  players: TournamentPlayerRow[]
): TournamentTable[][] {
  const byId = new Map(players.map((p) => [p.userId, p]));
  const rounds: TournamentTable[][] = [];
  const highest = tables.reduce((max, r) => Math.max(max, r.round), 0);
  for (let round = 1; round <= highest; round++) {
    const inRound = tables.filter((r) => r.round === round).sort((a, b) => a.tableNo - b.tableNo);
    const advance = advanceFor(t.shape, inRound.length);
    rounds.push(
      inRound.map((row) => ({
        round,
        table: row.tableNo,
        status: row.status,
        matchId: row.matchId,
        bye: row.bye,
        advance,
        seats: row.seats
          .map((uid) => byId.get(uid))
          .filter((p): p is TournamentPlayerRow => p !== undefined)
          .map((p) => seatOf(p, row)),
      }))
    );
  }
  return rounds;
}

export interface TournamentCard {
  id: string;
  kind: string;
  name: string;
  shape: TournamentShape;
  mode: Mode;
  seats: number;
  startsAt: Date;
  status: TournamentStatus;
  blurb: string;
  note?: string;
  entrants: number;
  registered: boolean; // whether the viewer is in it
  podium: TournamentRow['podium'];
  winner: string | null;
}

export interface TournamentView extends TournamentCard {
  round: number;
  entrantList: TournamentEntrant[];
  rounds: TournamentTable[][];
  you: TournamentBoard['you'];
}

function cardOf(t: TournamentRow, entrants: number, registered: boolean): TournamentCard {
  const fixture = fixtureFor(t.kind);
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    shape: t.shape,
    mode: t.mode,
    seats: t.seats,
    startsAt: t.startsAt,
    status: t.status,
    blurb: fixture?.blurb ?? '',
    ...(fixture?.note ? { note: fixture.note } : {}),
    entrants,
    registered,
    podium: t.podium,
    winner: t.podium?.find((p) => p.place === 1)?.name ?? null,
  };
}

function youOf(players: TournamentPlayerRow[], viewerId: string | null): TournamentBoard['you'] {
  if (!viewerId) return null;
  const mine = players.find((p) => p.userId === viewerId);
  if (!mine) return null;
  return {
    seed: mine.seed,
    place: mine.place,
    out: mine.withdrawn || mine.outRound !== null,
    registered: true,
  };
}

export async function tournamentView(id: string, viewerId: string | null): Promise<TournamentView | null> {
  const t = await getTournamentById(id);
  if (!t) return null;
  const players = await getTournamentPlayers(id);
  const tables = await getTournamentTables(id);
  return {
    ...cardOf(t, players.length, players.some((p) => p.userId === viewerId)),
    round: t.round,
    entrantList: players.map(entrantOf),
    rounds: roundsOf(t, tables, players),
    you: youOf(players, viewerId),
  };
}

/* What the tournaments page opens on: the upcoming fixtures, whatever is
   running, and a page of results. The schedule is stocked here as well as on
   the tick, so a fresh database answers the first request with three fixtures
   rather than with nothing, exactly as the arena listing does. */
export interface TournamentListing {
  upcoming: TournamentCard[];
  running: TournamentCard[];
  finished: TournamentCard[];
  total: number;
  page: number;
}

export async function tournamentListing(viewerId: string | null, page = 0): Promise<TournamentListing> {
  await ensureSchedule().catch((err) => console.error('tournament schedule could not be stocked:', err));
  const open = await getOpenTournaments();
  const settled = await getSettledTournaments(TOURNAMENT_PAGE, page * TOURNAMENT_PAGE);
  const rows = [...open, ...settled];
  const counts = await countTournamentPlayers(rows.map((r) => r.id));
  const mine = viewerId ? await registeredIn(viewerId, rows.map((r) => r.id)) : new Set<string>();
  const card = (r: TournamentRow) => cardOf(r, counts.get(r.id) ?? 0, mine.has(r.id));
  return {
    upcoming: open.filter((r) => r.status === 'upcoming').map(card),
    running: open.filter((r) => r.status === 'running').map(card),
    finished: settled.map(card),
    total: await countSettledTournaments(),
    page,
  };
}

async function registeredIn(userId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of ids) {
    if (await isTournamentPlayer(id, userId)) out.add(id);
  }
  return out;
}

/* --------------------------------------------------------------- the door */

type Refusal = { ok: false; status: number; error: string };

/* Registration. Open from the moment the row is created and closed at the
   start; there is no late registration, because a bracket whose first round
   has been drawn has no seat to put anybody in.

   **People are never refused a seat by a bot.** The population fills a
   fixture up to its own floor so a tournament is worth playing, and if the
   field is full when a person arrives the bot that registered last is
   withdrawn to make room. A field full of people is full. */
export async function registerForTournament(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const t = await getTournamentById(id);
  if (!t) return { ok: false, status: 404, error: 'No such tournament' };
  if (t.status !== 'upcoming') {
    return { ok: false, status: 409, error: 'Registration for this one has closed. The next one is already open.' };
  }
  const user = await getUserById(userId);
  if (!user) return { ok: false, status: 404, error: 'No such player' };

  /* A tournament can produce a rated match, so its door asks what every other
     rated door asks. Bots are exempt: the population decides who plays, and a
     bot that has not cleared the gate is one whose first tournament is where
     it clears it. */
  if (!user.bot) {
    if (!(await rankedUnlocked(userId))) {
      return {
        ok: false,
        status: 409,
        error: 'Play one casual game first. Tournaments open as soon as it finishes.',
      };
    }
    const banned = await rankedBanUntil(userId);
    if (banned !== null) return { ok: false, status: 409, error: rankedBanMessage(banned) };
  }

  if (await insertTournamentPlayer(id, userId, t.seats)) {
    await pushTournament(id);
    return { ok: true };
  }
  if (await isTournamentPlayer(id, userId)) return { ok: true };

  // Full. A person takes the seat of the bot that registered last; a bot that
  // finds it full simply does not play.
  if (user.bot) return { ok: false, status: 409, error: 'This tournament is full.' };
  const players = await getTournamentPlayers(id);
  const lastBot = [...players].filter((p) => p.bot).sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime())[0];
  if (!lastBot) return { ok: false, status: 409, error: 'This tournament is full. The next one is already open.' };
  await deleteTournamentPlayer(id, lastBot.userId);
  if (!(await insertTournamentPlayer(id, userId, t.seats))) {
    return { ok: false, status: 409, error: 'This tournament is full. The next one is already open.' };
  }
  await pushTournament(id);
  return { ok: true };
}

/* Withdrawing before the start takes the row away: somebody who is not
   playing is not in the field, and a seeding drawn around them would be a
   bracket with a hole in it. Withdrawing after the start is not a thing a
   button does; it is what a missed ready check means, and it keeps the row
   because there is still a place owed. */
export async function withdrawFromTournament(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const t = await getTournamentById(id);
  if (!t) return { ok: false, status: 404, error: 'No such tournament' };
  if (t.status !== 'upcoming') {
    return { ok: false, status: 409, error: 'This one has already started. Play your table or sit it out.' };
  }
  await deleteTournamentPlayer(id, userId);
  await pushTournament(id);
  return { ok: true };
}

/* ---------------------------------------------------------------- the page */

export function watchTournament(userId: string, id: string | null): void {
  const previous = watching.get(userId);
  if (previous) {
    watchers.get(previous)?.delete(userId);
    watching.delete(userId);
  }
  if (!id) return;
  watching.set(userId, id);
  let set = watchers.get(id);
  if (!set) {
    set = new Set();
    watchers.set(id, set);
  }
  set.add(userId);
}

// A socket that has gone is a page that has gone. Called from the websocket
// router's disconnect, beside the arena's own tidy-up.
export function unwatchTournament(userId: string): void {
  watchTournament(userId, null);
}

/* The board to everyone looking at it. Unlike the arena's there is no beat
   behind this and no `force`: a tournament changes on events, so every push is
   one worth making. */
async function pushTournament(id: string): Promise<void> {
  const set = watchers.get(id);
  if (!set || set.size === 0) return;
  const t = await getTournamentById(id);
  if (!t) return;
  const players = await getTournamentPlayers(id);
  const tables = await getTournamentTables(id);
  const rounds = roundsOf(t, tables, players);
  for (const userId of set) {
    hub.send(userId, {
      t: 'tournament',
      board: {
        id: t.id,
        status: t.status,
        round: t.round,
        entrants: players.length,
        rounds,
        you: youOf(players, userId),
      },
    });
  }
}

/* ------------------------------------------------------------------ tick */

/* One pass: stock the schedule, start whatever the clock says to, and settle
   any running round whose last table has landed. Exported so a test drives it
   a step at a time instead of waiting on the interval, the way `arenaTick`
   is.

   Wrapped end to end, for the reason the arena's is: this runs from a timer
   nobody awaits, and a rejection escaping it would take the process down
   along with every live match. */
export async function tournamentTick(): Promise<void> {
  if (!enabled || ticking) return;
  ticking = true;
  try {
    await ensureSchedule();
    const at = now();
    for (const t of await getOpenTournaments()) {
      if (t.status === 'upcoming' && at >= t.startsAt.getTime()) {
        await beginTournament(t);
        continue;
      }
      if (t.status === 'running') await settleTournament(t.id);
    }
  } catch (err) {
    console.error('tournament tick failed:', err);
  } finally {
    ticking = false;
  }
}

/* ----------------------------------------------------------- the population

   What the bot scheduler needs to know, kept here rather than there: which
   fixture is close enough to fill, and how many bots it may still take. */

export interface FillableTournament {
  id: string;
  kind: string;
  startsAt: Date;
  botFloor: number;
  seats: number;
  registered: number;
  bots: number;
}

/* Fixtures inside the registration window, with what is already in them. The
   population registers scheduled-online bots up to the fixture's floor and
   never above the seat cap; a person who arrives after that displaces the
   last bot, which is `registerForTournament`'s job and not this one's. */
export async function fillableTournaments(): Promise<FillableTournament[]> {
  const at = now();
  const out: FillableTournament[] = [];
  for (const t of await getOpenTournaments()) {
    if (t.status !== 'upcoming') continue;
    const startsAt = t.startsAt.getTime();
    if (startsAt <= at || startsAt - at > BOT_REGISTRATION_WINDOW_MS) continue;
    const fixture = fixtureFor(t.kind);
    if (!fixture) continue;
    const players = await getTournamentPlayers(t.id);
    out.push({
      id: t.id,
      kind: t.kind,
      startsAt: t.startsAt,
      botFloor: fixture.botFloor,
      seats: t.seats,
      registered: players.length,
      bots: players.filter((p) => p.bot).length,
    });
  }
  return out;
}
