import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { formatFor } from '@opentable/protocol';
import { sql, getPuzzleHandCandidates } from '../src/db.js';

/* The puzzle draw must cost the same however large the hands table grows, so
   it only looks at the newest finished matches. Created_at is pushed years into
   the future so rows from other test files never sit inside these windows. */

const tag = randomBytes(4).toString('hex');
const ids = {
  inside: [1, 2, 3].map((n) => `pc-in${n}-${tag}`),
  old: `pc-old-${tag}`,
  practice: `pc-practice-${tag}`,
  sixmax: `pc-six-${tag}`,
  playing: `pc-playing-${tag}`,
};
const all = [...ids.inside, ids.old, ids.practice, ids.sixmax, ids.playing];

async function addMatch(id: string, format: object, status: string, ageYears: number) {
  await sql`
    insert into matches (id, format, rated, seats, status, reason, hands_played, created_at, finished_at)
    values (${id}, ${sql.json(format as never)}, false, ${sql.json([] as never)}, ${status},
      ${status === 'finished' ? 'bust' : null}, 1, now() + ${`${ageYears} years`}::interval, ${status === 'finished' ? sql`now()` : null})
  `;
  await sql`
    insert into hands (id, match_id, number, seed_hash, seed, button, stacks_start, live_seats,
      actions, board, holes, result, completed_at)
    values (${`${id}-1`}, ${id}, 1, ${randomBytes(32).toString('hex')}, ${randomBytes(32).toString('hex')},
      0, ${sql.json([200, 200] as never)}, ${[0, 1]},
      ${sql.json([{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }] as never)}, ${[]},
      ${sql.json({ 0: ['Ah', 'Kd'], 1: ['7c', '2d'] } as never)},
      ${sql.json({ pots: [], awards: [], shown: {} } as never)}, now())
  `;
}

const matchOf = (h: { matchId?: string; match_id?: string }) => h.matchId ?? h.match_id;

describe('puzzle hand candidates', () => {
  beforeAll(async () => {
    const hu = formatFor('heads-up', true);
    for (const id of ids.inside) await addMatch(id, hu, 'finished', 10);
    await addMatch(ids.old, hu, 'finished', 9);
    await addMatch(ids.practice, { ...hu, practice: true }, 'finished', 8);
    await addMatch(ids.sixmax, formatFor('six-max', true), 'finished', 8);
    await addMatch(ids.playing, hu, 'playing', 12);
  });

  afterAll(async () => {
    await sql`delete from matches where id in ${sql(all)}`;
  });

  it('never returns a hand from a match older than the window, and does return the newer ones', async () => {
    const seen = new Set<string | undefined>();
    for (let i = 0; i < 40; i++) {
      for (const h of await getPuzzleHandCandidates(40, 3)) seen.add(matchOf(h));
    }
    expect(seen.has(ids.old)).toBe(false);
    for (const id of ids.inside) expect(seen.has(id)).toBe(true);
  });

  it('never returns practice, six-max or unfinished matches', async () => {
    const seen = new Set<string | undefined>();
    for (let i = 0; i < 20; i++) {
      for (const h of await getPuzzleHandCandidates(40)) seen.add(matchOf(h));
    }
    expect(seen.has(ids.practice)).toBe(false);
    expect(seen.has(ids.sixmax)).toBe(false);
    expect(seen.has(ids.playing)).toBe(false);
  });
});
