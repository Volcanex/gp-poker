import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, driveRandomPlay, testFormat } from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { getMatchById, getRating, getRatingHistoryForUser, sql } from '../src/db.js';

const CASUAL: MatchFormat = testFormat({ rated: false, hands: 3, stack: 20 });

describe('a casual match', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let matchId: string | null = null;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
  });

  afterAll(async () => {
    if (matchId) await sql`delete from matches where id = ${matchId}`;
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it(
    'leaves ratings alone and writes no rating history',
    async () => {
      const a = await mintGuestSession(app);
      const b = await mintGuestSession(app);
      createdUserIds.push(a.id, b.id);

      const before = await Promise.all([getRating(a.id, 'heads-up'), getRating(b.id, 'heads-up')]);

      const connA = await connectWs(wsUrl, a.token);
      const connB = await connectWs(wsUrl, b.token);
      await connA.messages.wait((m) => m.t === 'hi');
      await connB.messages.wait((m) => m.t === 'hi');

      matchId = await createMatchForPlayers([a.id, b.id], CASUAL);
      connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const [result] = await Promise.all([driveRandomPlay(connA), driveRandomPlay(connB)]);

      expect(result.rated).toBe(false);
      for (const id of [a.id, b.id]) {
        expect(result.ratings[id].after).toBe(result.ratings[id].before);
        expect(result.ratings[id].rdAfter).toBe(result.ratings[id].rdBefore);
        expect(await getRatingHistoryForUser(id)).toEqual([]);
      }
      expect(Object.keys(result.places).sort()).toEqual([a.id, b.id].sort());

      const after = await Promise.all([getRating(a.id, 'heads-up'), getRating(b.id, 'heads-up')]);
      after.forEach((standing, i) => {
        expect(standing.rating).toBe(before[i].rating);
        expect(standing.rd).toBe(before[i].rd);
        expect(standing.volatility).toBe(before[i].volatility);
        // Counters still move: a casual match is played, just not rated.
        expect(standing.matches).toBe(before[i].matches + 1);
      });

      const match = await getMatchById(matchId);
      expect(match!.rated).toBe(false);
      expect(match!.places).toEqual(result.places);

      connA.ws.close();
      connB.ws.close();
    },
    60_000
  );
});
