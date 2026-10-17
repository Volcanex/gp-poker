/* Hand retention by hand: report, or remove, the stored hands of old bot-only
   matches. The rules of what qualifies live in ../src/retention.ts and are the
   same ones the in-process sweep (HANDS_RETENTION_DAYS) uses.

     npx tsx server/scripts/hands-retention.ts --dry-run [--days 14]
     npx tsx server/scripts/hands-retention.ts --apply --days 14 [--batch 200] [--max-batches 1000]

   It needs one of --dry-run or --apply, so leaving both off does nothing. A dry
   run opens its connection with default_transaction_read_only on, so the
   server refuses any write it might attempt: it only ever SELECTs. It reads
   DATABASE_URL from the environment or the repo's .env and never prints it. */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { purgeBotOnlyHands, RETENTION_DEFAULT_BATCH, RETENTION_DEFAULT_MAX_BATCHES } from '../src/retention.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(name);

function usage(message: string): never {
  console.error(`${message}\nusage: hands-retention.ts (--dry-run | --apply) [--days N] [--batch N] [--max-batches N]`);
  process.exit(2);
}

async function main() {
  const dryRun = has('--dry-run');
  const apply = has('--apply');
  if (dryRun === apply) usage('pass exactly one of --dry-run or --apply');

  const days = Number(arg('--days') ?? 14);
  const batchMatches = Number(arg('--batch') ?? RETENTION_DEFAULT_BATCH);
  const maxBatches = Number(arg('--max-batches') ?? RETENTION_DEFAULT_MAX_BATCHES);
  if (!(days >= 1) || !(batchMatches >= 1) || !(maxBatches >= 1)) usage('--days, --batch and --max-batches must be numbers >= 1');

  const envFile = path.resolve(here, '../../.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.DATABASE_URL;
  if (!url) usage('DATABASE_URL is not set and the repo .env has none');

  const sql = postgres(url, {
    max: 1,
    connection: {
      application_name: dryRun ? 'hands-retention-dry-run' : 'hands-retention',
      ...(dryRun ? { default_transaction_read_only: 'on' } : {}),
    },
  });
  try {
    const started = Date.now();
    const r = await purgeBotOnlyHands(sql, { olderThanDays: days, dryRun, batchMatches, maxBatches });
    const ms = Date.now() - started;
    if (r.dryRun) {
      const mb = ((r.rowBytes ?? 0) / 1024 / 1024).toFixed(1);
      console.log(
        `dry run: ${r.hands} hands in ${r.matches} bot-only matches ended before ${r.cutoff.toISOString()} would be removed (${mb} MB of row data, before index entries and page overhead). ${ms} ms, nothing written.`
      );
    } else {
      console.log(
        `removed ${r.hands} hands from ${r.matches} bot-only matches ended before ${r.cutoff.toISOString()} in ${r.batches} batches, ${ms} ms${r.truncated ? ', stopped at --max-batches with more left' : ''}.`
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
