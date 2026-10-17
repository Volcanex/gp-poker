import type postgres from 'postgres';

/* Hand retention: the one place rows are taken out of `hands`.

   Why it exists. The bot population plays around the clock, and on
   2026-10-17 more than 99 percent of the 45k to 60k hands written a day came
   from tables with no human at them. A stored hand is about 1.3 KB with its
   index entries, so the table had reached 2.2 GB on a box with 5 GB of disk
   left, and Postgres had already failed to extend it twice (2026-10-04 and
   2026-10-10, "No space left on device" on the hands relation).

   What it removes, and nothing else. The hand rows of a match that
     - is over (finished or aborted, never playing),
     - ended before the cutoff (`olderThanDays`),
     - had nobody at it but bots (every match_players row is a `users.bot`
       account, and there is at least one such row),
     - is an ordinary table: not a tournament, an arena or a home game, whose
       pages are events people come back to whoever ended up seated.
   A match with a human in it keeps every hand for good, which is the promise
   the site makes ("every match has a permanent public URL with hand
   histories"). The match row itself is never touched: result, places, final
   stacks, ratings and rating history all stay, so the match URL still
   resolves and the leaderboard is unchanged. `/api/matches/:id` says
   `handsExpired` when a finished match played hands and has none left.

   What reads old hands, and what this costs each of them. The match page and
   the per-hand replay of a purged match lose their hand list (bots only). The
   profile aggregates of a bot (VPIP, PFR, preflop accuracy) become figures
   over the retained window instead of over its whole life. Insights read the
   newest 3000 hands, the explorer its newest window and the puzzle its random
   draw; none of them reaches past a fortnight for a bot. The site's
   "hands played" count is read off `matches.hands_played`, which the purge
   leaves alone, so it does not drop.

   The work is done in batches of matches, one statement per batch, so each
   lock is short and each WAL burst small, and the bot-only test is evaluated
   inside the delete itself rather than on a list read earlier. A dry run
   reads the same set and reports it without deleting anything; run from the
   CLI it also opens its connection read-only, so it cannot write even by
   mistake. Disk is not handed back to the operating system by a delete:
   Postgres reuses the freed pages for new hands, which is what stops the
   growth. Shrinking the file is a separate, owner-run VACUUM FULL. */

export interface RetentionOptions {
  /** Hands of qualifying matches that ended more than this many days ago go. */
  olderThanDays: number;
  /** True reports what would go and deletes nothing. */
  dryRun: boolean;
  /** Matches per delete statement. */
  batchMatches?: number;
  /** Stop after this many batches (a cap on one run's work). */
  maxBatches?: number;
  /** Pause between batches, so a live server keeps its share of the disk. */
  pauseMs?: number;
  /** The clock, for tests. */
  now?: Date;
}

export interface RetentionReport {
  dryRun: boolean;
  cutoff: Date;
  /** Matches whose hands were (or would be) removed. */
  matches: number;
  /** Hand rows removed (or that would be). */
  hands: number;
  /** Sum of pg_column_size over those rows: the heap bytes they hold, before
      index entries and page overhead. Dry runs only; null after a delete. */
  rowBytes: number | null;
  batches: number;
  /** True when maxBatches stopped the run with work left. */
  truncated: boolean;
}

export const RETENTION_DEFAULT_BATCH = 200;
export const RETENTION_DEFAULT_MAX_BATCHES = 1000;
export const RETENTION_DEFAULT_PAUSE_MS = 250;

// A Sql of any transform: the CLI's own client and the app's camel one both fit.
type Sql = postgres.Sql<any>;

export function retentionCutoff(olderThanDays: number, now: Date = new Date()): Date {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    throw new Error(`olderThanDays must be a whole number of days >= 1, got ${olderThanDays}`);
  }
  return new Date(now.getTime() - Math.floor(olderThanDays) * 86_400_000);
}

/* The qualifying-match predicate, shared by the dry run and the delete so the
   two can never disagree about what goes. `m` is the matches alias. */
function purgeable(sql: Sql, cutoff: Date) {
  return sql`
    m.status in ('finished', 'aborted')
    and coalesce(m.finished_at, m.created_at) < ${cutoff}
    and not (m.format ? 'tournament')
    and not (m.format ? 'arena')
    and not (m.format ? 'homeGame')
    and exists (select 1 from match_players mp where mp.match_id = m.id)
    and not exists (
      select 1 from match_players mp
      join users u on u.id = mp.user_id
      where mp.match_id = m.id and not u.bot
    )
    and exists (select 1 from hands h where h.match_id = m.id)
  `;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function purgeBotOnlyHands(sql: Sql, opts: RetentionOptions): Promise<RetentionReport> {
  const cutoff = retentionCutoff(opts.olderThanDays, opts.now);

  if (opts.dryRun) {
    const [row] = await sql<{ matches: number; hands: number; bytes: string | null }[]>`
      select
        count(distinct h.match_id)::int as matches,
        count(*)::int as hands,
        coalesce(sum(pg_column_size(h.*)), 0)::bigint as bytes
      from hands h
      where h.match_id in (select m.id from matches m where ${purgeable(sql, cutoff)})
    `;
    return {
      dryRun: true,
      cutoff,
      matches: row?.matches ?? 0,
      hands: row?.hands ?? 0,
      rowBytes: Number(row?.bytes ?? 0),
      batches: 0,
      truncated: false,
    };
  }

  const batchMatches = opts.batchMatches ?? RETENTION_DEFAULT_BATCH;
  const maxBatches = opts.maxBatches ?? RETENTION_DEFAULT_MAX_BATCHES;
  const pauseMs = opts.pauseMs ?? RETENTION_DEFAULT_PAUSE_MS;
  let matches = 0;
  let hands = 0;
  let batches = 0;
  let truncated = false;

  for (;;) {
    if (batches >= maxBatches) {
      truncated = true;
      break;
    }
    const [row] = await sql<{ matches: number; hands: number }[]>`
      with victims as (
        select m.id from matches m
        where ${purgeable(sql, cutoff)}
        order by m.created_at asc
        limit ${batchMatches}
      ),
      gone as (
        delete from hands h using victims v
        where h.match_id = v.id
        returning h.match_id
      )
      select count(distinct match_id)::int as matches, count(*)::int as hands from gone
    `;
    batches += 1;
    matches += row?.matches ?? 0;
    hands += row?.hands ?? 0;
    if ((row?.matches ?? 0) < batchMatches) break;
    if (pauseMs > 0) await sleep(pauseMs);
  }

  return { dryRun: false, cutoff, matches, hands, rowBytes: null, batches, truncated };
}

/* The in-process sweep. Off unless HANDS_RETENTION_DAYS is set to a number of
   days (config.handsRetentionDays): deleting hands is a policy the owner turns
   on, not a default a deploy should switch on by itself. It runs a while after
   boot and then daily, one batch at a time with a pause between, and logs one
   line per run. */
let sweepTimer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;

export const RETENTION_SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_FIRST_SWEEP_MS = 10 * 60 * 1000;

export function startHandsRetention(sql: Sql, olderThanDays: number, log: (line: string) => void = console.log): void {
  if (!(olderThanDays >= 1) || sweepTimer || firstTimer) return;
  const run = async () => {
    try {
      const r = await purgeBotOnlyHands(sql, { olderThanDays, dryRun: false });
      log(
        `hands retention: removed ${r.hands} hands from ${r.matches} bot-only matches ended before ${r.cutoff.toISOString()} in ${r.batches} batches${r.truncated ? ' (stopped at the batch cap, more next run)' : ''}`
      );
    } catch (err) {
      log(`hands retention failed: ${String(err)}`);
    }
  };
  firstTimer = setTimeout(() => {
    firstTimer = null;
    void run();
    sweepTimer = setInterval(() => void run(), RETENTION_SWEEP_EVERY_MS);
    sweepTimer.unref();
  }, RETENTION_FIRST_SWEEP_MS);
  firstTimer.unref();
}

export function stopHandsRetention(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  firstTimer = null;
  sweepTimer = null;
}
