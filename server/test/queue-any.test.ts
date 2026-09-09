import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MODES, SPEEDS } from '@opentable/protocol';
import { __queueForTest, dequeue, enqueue, tick } from '../src/matchmaking.js';
import { deleteUser, makeApp, mintGuestSession } from './helpers.js';

/* "Any" is a fact about a search, not a format: it puts one player into more
   than one of the real (mode, rated, speed) queues at once. These prove the
   two halves of that, without a socket or a tick: what a search accepts, and
   that it never widens the one thing it must not. */
describe('a search that says any', () => {
  let app: FastifyInstance;
  const ids: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
  });
  afterEach(() => {
    for (const id of ids) dequeue(id);
  });
  afterAll(async () => {
    for (const id of ids) await deleteUser(id);
    await app.close();
  });

  it('accepts every mode and speed it did not name', async () => {
    const user = await mintGuestSession(app);
    ids.push(user.id);
    await enqueue(user.id, 'any', false, 'any');

    const entry = __queueForTest().get(user.id);
    expect(entry).toBeDefined();
    expect([...entry!.modes].sort()).toEqual([...MODES].sort());
    expect([...entry!.speeds].sort()).toEqual([...SPEEDS].sort());
  });

  it('accepts only what it named when it named one', async () => {
    const user = await mintGuestSession(app);
    ids.push(user.id);
    await enqueue(user.id, 'heads-up', false, 'fast');

    const entry = __queueForTest().get(user.id);
    expect(entry!.modes).toEqual(['heads-up']);
    expect(entry!.speeds).toEqual(['fast']);
  });

  /* Rated has no "any" on the wire, and this is the guard that says so from
     the queue's side: casual and ranked never end up in one another's tables
     however wide the rest of the search is. */
  it('never widens rated', async () => {
    const casual = await mintGuestSession(app);
    ids.push(casual.id);
    await enqueue(casual.id, 'any', false, 'any');

    const entry = __queueForTest().get(casual.id)!;
    expect(entry.rated).toBe(false);
  });

  /* The point of the whole thing: a wide search and a narrow one meet, which
     under the old one-queue-per-triple arrangement they never could. Heads-up
     so the pair is dealt on the spot rather than waiting for six. */
  it('pairs a wide search with a narrow one', async () => {
    const wide = await mintGuestSession(app);
    const narrow = await mintGuestSession(app);
    ids.push(wide.id, narrow.id);

    await enqueue(wide.id, 'any', false, 'any');
    await enqueue(narrow.id, 'heads-up', false, 'fast');
    expect(__queueForTest().size).toBe(2);

    await tick();

    // Both seated, so neither is waiting any more.
    expect(__queueForTest().has(wide.id)).toBe(false);
    expect(__queueForTest().has(narrow.id)).toBe(false);
  });

  /* And the boundary it must not cross while doing it. */
  it('does not pair across ranked and casual', async () => {
    const casual = await mintGuestSession(app);
    const ranked = await mintGuestSession(app);
    ids.push(casual.id, ranked.id);

    await enqueue(casual.id, 'any', false, 'any');
    await enqueue(ranked.id, 'any', true, 'any');

    await tick();

    // The ranked one is refused at the door for being unranked, so the only
    // thing that matters here is that the casual one is still waiting: it was
    // never a table for two.
    expect(__queueForTest().has(casual.id)).toBe(true);
  });
});
