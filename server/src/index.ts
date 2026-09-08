import { buildApp } from './app.js';
import { config } from './config.js';
import { sql } from './db.js';
import { startArena, stopArena } from './arena.js';
import { startLadder, stopLadder } from './ladder.js';
import { startMatchmaking, stopMatchmaking } from './matchmaking.js';

async function main() {
  const app = await buildApp();

  startMatchmaking();
  // After buildApp, which is where ensureBots loaded the roster: the ladder
  // has nobody to seat until the bots exist, and neither has an arena that
  // needs to fill a lone player's table.
  startLadder();
  startArena();

  await app.listen({ host: config.host, port: config.port });

  const shutdown = async () => {
    stopMatchmaking();
    stopLadder();
    stopArena();
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
