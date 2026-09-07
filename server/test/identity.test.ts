import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { formatFor } from '@opentable/protocol';
import { isGeneratedName } from '@opentable/identity';
import {
  finishMatch,
  getMatchesForUser,
  getUserById,
  insertGuestUser,
  insertMatch,
  insertMatchPlayers,
  sql,
} from '../src/db.js';
import { migrateBotRoster } from '../src/bots/index.js';
import { makeApp, mintGuestSession, deleteUser } from './helpers.js';

describe('guest naming', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    await app.close();
  });

  it('mints a CamelCase name from the identity word lists', async () => {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    expect(session.name).toMatch(/^[A-Z][a-z]+(?:[A-Z][a-z]+){1,2}$/);
    expect(isGeneratedName(session.name)).toBe(true);
  });

  it('never mints the same name for two guests', async () => {
    const sessions = await Promise.all(Array.from({ length: 15 }, () => mintGuestSession(app)));
    for (const s of sessions) createdUserIds.push(s.id);
    const names = sessions.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('bot roster rename migration', () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
  });

  it('is idempotent', async () => {
    const legacyName = `bot-migrationtest-${Date.now().toString(36)}`;
    const [inserted] = await sql<{ id: string }[]>`
      insert into users (name, name_lower, guest, bot)
      values (${legacyName}, ${legacyName.toLowerCase()}, false, true)
      returning id
    `;
    createdUserIds.push(inserted.id);

    // A slot for the fixture plus slack for any other legacy row a
    // concurrent test run might have left behind.
    const candidates = Array.from({ length: 10 }, (_, i) => `ZzzMigrationTarget${i}`);

    await migrateBotRoster(candidates);
    const afterFirst = await getUserById(inserted.id);
    expect(afterFirst!.name.startsWith('bot-')).toBe(false);
    expect(candidates).toContain(afterFirst!.name);

    // Running it again must not error (no unique-violation retry of an
    // already-renamed row) and must leave the name exactly as it was.
    await migrateBotRoster(candidates);
    const afterSecond = await getUserById(inserted.id);
    expect(afterSecond!.name).toBe(afterFirst!.name);
  });
});

describe('match history', () => {
  const createdUserIds: string[] = [];
  const createdMatchIds: string[] = [];

  afterAll(async () => {
    for (const id of createdMatchIds) await sql`delete from matches where id = ${id}`;
    for (const id of createdUserIds) await deleteUser(id);
  });

  it('carries the opponent id alongside the opponent name', async () => {
    const a = await insertGuestUser(`OppTestA${Date.now().toString(36)}`);
    const b = await insertGuestUser(`OppTestB${Date.now().toString(36)}`);
    createdUserIds.push(a.id, b.id);

    const matchId = `opptest-${Date.now().toString(36)}`;
    createdMatchIds.push(matchId);
    const format = formatFor('heads-up', true);
    const seats = [
      { seat: 0, userId: a.id, name: a.name, rating: 1500, bot: false },
      { seat: 1, userId: b.id, name: b.name, rating: 1500, bot: false },
    ];
    await insertMatch(matchId, format, seats, true);
    await insertMatchPlayers(matchId, [
      { userId: a.id, seat: 0 },
      { userId: b.id, seat: 1 },
    ]);
    await finishMatch(matchId, {
      status: 'finished',
      mode: 'heads-up',
      rated: true,
      winner: a.id,
      reason: 'hands',
      finalStacks: { [a.id]: 220, [b.id]: 180 },
      places: { [a.id]: 1, [b.id]: 1 },
      ratings: {},
      players: [
        { userId: a.id, place: 1, outcome: 'win', rating: null },
        { userId: b.id, place: 1, outcome: 'loss', rating: null },
      ],
    });

    const history = await getMatchesForUser(a.id);
    const row = history.find((h) => h.id === matchId);
    expect(row).toBeDefined();
    expect(row!.opponent).toBe(b.name);
    expect(row!.opponentId).toBe(b.id);
  });
});
