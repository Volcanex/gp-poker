import { buildApp } from './app.js';
import { config } from './config.js';
import { sql } from './db.js';
import { startMatchmaking, stopMatchmaking } from './matchmaking.js';

async function main() {
  const app = await buildApp();

  startMatchmaking();

  await app.listen({ host: config.host, port: config.port });

  const shutdown = async () => {
    stopMatchmaking();
    await app.close();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
