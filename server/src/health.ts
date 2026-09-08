import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { sql } from './db.js';
import { rosterSummary } from './bots/index.js';

/* GET /health, in the shape gcore's health contract asks for:
   { ok, checks: { <key>: { ok, detail } } }, always HTTP 200 while the
   process is answering. The status code says "the server is up"; whether
   anything it leans on is healthy is what `checks` is for, and brain's L5
   probe forwards the named checks to the alert spine. Every check is
   individually guarded, so one that throws is a false check rather than a
   500 that makes the whole box look dead. */

export interface Check {
  ok: boolean;
  detail: string;
}

export interface Health {
  ok: boolean;
  checks: Record<string, Check>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// The repo root, from either src/ in development or release/server/ in
// production: the volume that holds release/ and everything the service
// serves out of it.
const releaseRoot = path.resolve(here, '..', '..');

export const BACKUP_DIR = '/home/gabriel/backups/opentable';
// A daily timer that has missed one run is still fine; two is a broken timer.
export const BACKUP_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const DISK_MIN_BYTES = 1024 ** 3;

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function backupCheck(newest: { name: string; mtimeMs: number } | null, now = Date.now()): Check {
  if (!newest) return { ok: false, detail: 'no dump yet' };
  const age = now - newest.mtimeMs;
  const detail = `${newest.name}, ${hours(age)} old`;
  return { ok: age < BACKUP_MAX_AGE_MS, detail };
}

export function diskCheck(freeBytes: number): Check {
  const gb = (freeBytes / 1024 ** 3).toFixed(2);
  return { ok: freeBytes > DISK_MIN_BYTES, detail: `${gb} GB free on ${releaseRoot}` };
}

export function botsCheck(loaded: number, expected: number): Check {
  return { ok: loaded === expected, detail: `${loaded}/${expected} bots loaded` };
}

export function ladderCheck(enabled: boolean, lastAt: Date | null): Check {
  if (!enabled) return { ok: true, detail: 'disabled' };
  // A ladder with no match yet is idle, not broken: it only plays in the gaps
  // when nobody is queued, so an empty history is what a busy day looks like.
  if (!lastAt) return { ok: true, detail: 'enabled, idle' };
  return { ok: true, detail: `enabled, last match ${lastAt.toISOString()}` };
}

async function newestBackup(): Promise<{ name: string; mtimeMs: number } | null> {
  // A directory that is not there yet is the same answer as one with nothing
  // in it: no dump, said plainly rather than as an ENOENT.
  const entries = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const names = entries.filter((n) => n.endsWith('.sql.gz')).sort();
  const name = names.at(-1);
  if (!name) return null;
  return { name, mtimeMs: (await stat(path.join(BACKUP_DIR, name))).mtimeMs };
}

async function guard(run: () => Promise<Check>): Promise<Check> {
  try {
    return await run();
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function health(): Promise<Health> {
  const checks: Record<string, Check> = {
    db: await guard(async () => {
      const started = Date.now();
      await sql`select 1`;
      return { ok: true, detail: `${Date.now() - started}ms` };
    }),
    bots: await guard(async () => botsCheck((await rosterSummary()).length, config.botCount)),
    ladder: await guard(async () => {
      /* Read here rather than in db.ts, which holds the queries the product
         runs; this one exists only to describe the ladder to an operator. */
      const [row] = await sql<{ at: Date }[]>`
        select coalesce(finished_at, created_at) as at from matches
        where format->>'ladder' = 'true' order by at desc limit 1
      `;
      return ladderCheck(config.ladderEnabled, row?.at ?? null);
    }),
    disk: await guard(async () => {
      const fs = await statfs(releaseRoot);
      return diskCheck(fs.bavail * fs.bsize);
    }),
    backup: await guard(async () => backupCheck(await newestBackup())),
  };
  return { ok: Object.values(checks).every((c) => c.ok), checks };
}
