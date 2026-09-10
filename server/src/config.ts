import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

try {
  process.loadEnvFile(path.join(repoRoot, '.env'));
} catch {
  // no .env file; rely on the environment already having these set
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

// Tests run against their own database. `TEST_DATABASE_URL` in the repo .env
// points at it, and a test process is anything vitest starts. Without this a
// test run writes to whatever the live server is using, which is how the
// bots' ratings were once moved by a test suite rather than by poker. The
// fallback to DATABASE_URL exists only so a checkout with no test database
// still runs; it is not the intended setup.
const inTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

function databaseUrl(): string {
  if (inTest && process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  return required('DATABASE_URL');
}

export const config = {
  databaseUrl: databaseUrl(),
  isTest: inTest,
  port: Number(process.env.PORT ?? 8130),
  host: process.env.HOST ?? '127.0.0.1',
  sessionSecret: required('SESSION_SECRET'),
  // Fastify logs every request at 'info' by default, which is noise in
  // journald for a small box; 'warn' surfaces only errors/warnings unless
  // overridden.
  logLevel: process.env.LOG_LEVEL ?? 'warn',
  // The bot population: how many named accounts exist. Small under vitest by
  // default (kept at the old roster size) so every test file's boot does not
  // pay to upsert 120 rows; a test that wants the real size sets
  // POPULATION_SIZE itself. `botCount` is this, kept as the name most of the
  // codebase (and `/health`) already reads.
  botCount: Number(process.env.POPULATION_SIZE ?? process.env.BOT_COUNT ?? (inTest ? 15 : 120)),
  // Caps how many tables are running with no human at any of them, for CPU:
  // a table's worth of decisions still runs on a timer even though nobody is
  // watching.
  populationMaxTables: Number(process.env.POPULATION_MAX_TABLES ?? 12),
  // Whether the population's own play counts on the public surface: /api/live,
  // /api/recent, the online and playing counts, the leaderboard, profiles.
  // Off leaves every one of those exactly as it behaved before the
  // population existed. Defaults to on whenever there is a population at
  // all, because a population nobody can see is not what it is for - except
  // under vitest, where it defaults off like every other population/ladder
  // knob: existing tests build bot-only matches through test seams
  // (`createMatchForPlayers`) to prove the *old* "no human, not shown"
  // behaviour, and a suite that quietly changed what they were proving would
  // be a suite lying about what it tests. `feed.test.ts` is where this is
  // pinned; a test that wants the population's own visibility asks for it
  // explicitly.
  populationPublic: process.env.POPULATION_PUBLIC ? process.env.POPULATION_PUBLIC === 'true' : !inTest,
  // The scheduler that decides who is online and sends them to queue on
  // their own. Off under vitest unless a test turns it on through
  // `configurePopulation`, the same reason the ladder and the arena are: a
  // suite that quietly queues bots in the background has timings that are
  // not its own. On the box this is what makes the ladder redundant, so
  // `index.ts` starts one or the other, never both.
  populationEnabled: process.env.POPULATION_ENABLED ? process.env.POPULATION_ENABLED === 'true' : !inTest,
  // The bot ladder: bots play each other in the background, rated, so the
  // levels spread out before any human arrives. Superseded by the population
  // once that is enabled (see `index.ts`), and kept as the fallback for a box
  // that turns the population off. Off under vitest unless a test turns it on
  // through `configureLadder`, because a suite that quietly plays poker in
  // the background is a suite whose timings are somebody else's.
  ladderEnabled: process.env.LADDER_ENABLED ? process.env.LADDER_ENABLED === 'true' : !inTest,
  // Gap between one ladder match ending and the next being considered. The
  // ladder is meant to trickle, not to grind: it exists to make the numbers
  // real, and it gives the box back between matches.
  ladderPauseMs: Number(process.env.LADDER_PAUSE_MS ?? 60_000),
  // Arenas: the hourly heads-up event. Off under vitest unless a test turns it
  // on through `configureArena`, for the reason the ladder is: a suite that
  // quietly pairs matches in the background has timings that are not its own.
  arenaEnabled: process.env.ARENA_ENABLED ? process.env.ARENA_ENABLED === 'true' : !inTest,
  // Tournaments: the three fixtures on the calendar. Off under vitest unless a
  // test turns them on through `configureTournaments`, for the reason the
  // arena is off: a scheduler that quietly opens a fixture and deals thirty-two
  // seats in the background has timings that are not the suite's own.
  tournamentsEnabled: process.env.TOURNAMENTS_ENABLED
    ? process.env.TOURNAMENTS_ENABLED === 'true'
    : !inTest,
  /* How far behind the present the opening explorer reads. A hand row is
     written when the hand completes, and two matches running side by side can
     commit out of order, so the window stops short of now and never closes
     over a row that has not landed yet. Zero under vitest: a test plays a
     match and then asks about it, and ten seconds of waiting to prove an
     ordering guarantee that a single-match suite cannot violate is ten
     seconds of nothing. */
  explorerLagMs: Number(process.env.EXPLORER_LAG_MS ?? (inTest ? 0 : 10_000)),
};

/* Whether a bot account is shown as one. While the population plays in public
   (`populationPublic`) the site is meant to read as a room full of people, so
   every public payload (profiles, feeds, seats, chat, arena boards) carries
   `bot: false` for them. The database row keeps `bot = true` regardless: this
   is presentation, and the reset script and the roster still know who is who.
   A practice table is the exception: there the person chose to play bots, so
   its bots are shown as bots (and carry no flag, see matchmaking.ts).
   The practice picker's own roster (`/api/bots`) is the one place bots are
   listed as bots on purpose, and it does not go through here. */
export function shownAsBot(isBot: boolean | null | undefined, practice = false): boolean {
  return isBot === true && (practice || !config.populationPublic);
}
