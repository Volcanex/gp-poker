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
  // How many of the named bot accounts to keep alive. The whole roster, so
  // every level has its three bots: a practice table asks for a level, and a
  // level with nobody loaded cannot be practised against.
  botCount: Number(process.env.BOT_COUNT ?? 15),
};
