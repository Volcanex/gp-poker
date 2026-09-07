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

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 8130),
  host: process.env.HOST ?? '127.0.0.1',
  sessionSecret: required('SESSION_SECRET'),
  // Fastify logs every request at 'info' by default, which is noise in
  // journald for a small box; 'warn' surfaces only errors/warnings unless
  // overridden.
  logLevel: process.env.LOG_LEVEL ?? 'warn',
  // How many of the named bot accounts to keep alive. Six is enough to fill
  // a six-max table around a single human.
  botCount: Number(process.env.BOT_COUNT ?? 6),
};
