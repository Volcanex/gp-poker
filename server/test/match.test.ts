import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { replay, seedHash, type HandConfig } from '@opentable/engine';
import type { MatchFormat, TableView } from '@opentable/protocol';
import { makeApp, mintGuestSession, deleteUser, listenForWs, connectWs, driveRandomPlay, testFormat } from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { getHandById, getHandsForMatch, getMatchById, getRating, getRatingHistoryForUser, sql } from '../src/db.js';

// Short stacks relative to the blinds so the match tends to bust in a handful
// of hands under random play, and a low hand cap as a backstop either way -
// keeps this test fast without weakening what it actually exercises.
const TEST_FORMAT: MatchFormat = testFormat({ hands: 5, stack: 20 });

describe('a full match', () => {
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
    'plays start to finish with random legal actions and settles correctly',
    async () => {
      const a = await mintGuestSession(app);
      const b = await mintGuestSession(app);
      createdUserIds.push(a.id, b.id);

      const connA = await connectWs(wsUrl, a.token);
      const connB = await connectWs(wsUrl, b.token);
      await connA.messages.wait((m) => m.t === 'hi');
      await connB.messages.wait((m) => m.t === 'hi');

      // Independent of the driver loops' own consumption, so we can audit
      // every frame B ever received afterwards, including ones that were
      // never "it's your turn" and so never got dequeued by driveRandomPlay.
      const framesB: any[] = [];
      connB.ws.on('message', (raw: Buffer) => framesB.push(JSON.parse(raw.toString())));

      matchId = await createMatchForPlayers([a.id, b.id], TEST_FORMAT);

      connA.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      connB.ws.send(JSON.stringify({ t: 'join', m: matchId }));

      const [resultA, resultB] = await Promise.all([driveRandomPlay(connA), driveRandomPlay(connB)]);
      expect(resultA).toEqual(resultB);

      expect(['bust', 'hands']).toContain(resultA.reason);
      const ratingA = resultA.ratings[a.id];
      const ratingB = resultA.ratings[b.id];
      expect(ratingA).toBeDefined();
      expect(ratingB).toBeDefined();
      if (resultA.winner === null) {
        // draw: rating stays put (score 0.5 vs an equal opponent), RD still drops
        expect(ratingA.rdAfter).toBeLessThan(ratingA.rdBefore);
        expect(ratingB.rdAfter).toBeLessThan(ratingB.rdBefore);
      } else {
        expect(ratingA.after).not.toBe(ratingA.before);
        expect(ratingB.after).not.toBe(ratingB.before);
      }

      const historyA = await getRatingHistoryForUser(a.id);
      const historyB = await getRatingHistoryForUser(b.id);
      expect(historyA.length).toBe(1);
      expect(historyB.length).toBe(1);
      expect(historyA[0].mode).toBe('heads-up');

      // The other direction of the per-mode split: a heads-up match moves
      // the heads-up row and leaves six-max at its untouched default.
      for (const id of [a.id, b.id]) {
        const headsUp = await getRating(id, 'heads-up');
        expect(headsUp.matches).toBe(1);
        expect(Math.round(headsUp.rating)).toBe(resultA.ratings[id].after);
        const sixMax = await getRating(id, 'six-max');
        expect(sixMax.rating).toBe(1500);
        expect(sixMax.matches).toBe(0);
      }

      const match = await getMatchById(matchId);
      expect(match).not.toBeNull();
      expect(match!.status).toBe('finished');
      expect(match!.finalStacks).toEqual(resultA.stacks);

      const hands = await getHandsForMatch(matchId);
      expect(hands.length).toBe(match!.handsPlayed);
      expect(hands.every((h) => h.completedAt !== null)).toBe(true);

      for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        expect(seedHash(h.seed!)).toBe(h.seedHash);

        const fullHand = await getHandById(`${matchId}-${h.number}`);
        const holes = fullHand!.holes!;
        const actions = fullHand!.actions;

        const config: HandConfig = {
          seats: match!.seats.map((s) => ({ id: s.userId, stack: h.stacksStart[s.seat] })),
          button: fullHand!.button,
          sb: match!.format.sb,
          bb: match!.format.bb,
          seed: h.seed!,
        };
        const states = replay(config, actions);
        const initial = states[0];
        const final = states[states.length - 1];

        expect(initial.seats.map((s) => s.cards)).toEqual([holes[0], holes[1]]);
        expect(final.board).toEqual(h.board);

        const expectedNextStacks =
          i + 1 < hands.length ? hands[i + 1].stacksStart : (match!.finalStacks as Record<string, number>);
        if (i + 1 < hands.length) {
          expect(final.seats.map((s) => s.stack)).toEqual(expectedNextStacks);
        } else {
          const byUserId = Object.fromEntries(final.seats.map((s, idx) => [match!.seats[idx].userId, s.stack]));
          expect(byUserId).toEqual(expectedNextStacks);
        }
      }

      // A's holes must never appear in a frame B received while that hand
      // was still live.
      const aSeat = match!.seats.find((s) => s.userId === a.id)!.seat;
      for (const frame of framesB) {
        if (frame.t !== 'state' || frame.s.street === 'done') continue;
        const view: TableView = frame.s;
        const aSeatView = view.seats.find((s) => s.i === aSeat);
        if (!aSeatView) continue;
        expect(
          aSeatView.cards === null || (Array.isArray(aSeatView.cards) && aSeatView.cards.every((c) => c === '?'))
        ).toBe(true);
      }

      connA.ws.close();
      connB.ws.close();
    },
    60_000
  );
});
