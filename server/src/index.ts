import { buildApp } from './app.js';
import { config } from './config.js';
import { sql } from './db.js';
import { startArena, stopArena } from './arena.js';
import { startTournaments, stopTournaments } from './tournaments/index.js';
import { startLadder, stopLadder } from './ladder.js';
import { startPopulation, stopPopulation } from './bots/population.js';
import { startMatchmaking, stopMatchmaking } from './matchmaking.js';
import { startHandsRetention, stopHandsRetention } from './retention.js';

async function main() {
  const app = await buildApp();

  startMatchmaking();
  // After buildApp, which is where ensureBots loaded the roster: nothing
  // here has anybody to seat until the bots exist. The population and the
  // ladder are the same idea at two different sizes - bots earning real
  // rated results in the gaps - so only one runs: the population when it is
  // on, since it does everything the ladder did and does it in public; the
  // ladder as the fallback for a box that has turned the population off.
  if (config.populationEnabled) startPopulation();
  else startLadder();
  startArena();
  startTournaments();
  startHandsRetention(sql, config.handsRetentionDays);

  await app.listen({ host: config.host, port: config.port });

  const shutdown = async () => {
    stopMatchmaking();
    stopPopulation();
    stopLadder();
    stopArena();
    stopTournaments();
    stopHandsRetention();
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
