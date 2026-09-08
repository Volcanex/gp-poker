import { buildApp } from './app.js';
import { config } from './config.js';
import { sql } from './db.js';
import { startLadder, stopLadder } from './ladder.js';
import { startMatchmaking, stopMatchmaking } from './matchmaking.js';

async function main() {
  const app = await buildApp();

  startMatchmaking();
  // After buildApp, which is where ensureBots loaded the roster: the ladder
  // has nobody to seat until the bots exist.
  startLadder();

  await app.listen({ host: config.host, port: config.port });

  const shutdown = async () => {
    stopMatchmaking();
    stopLadder();
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
