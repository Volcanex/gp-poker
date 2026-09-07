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
};
