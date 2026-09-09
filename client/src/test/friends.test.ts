import { describe, expect, it } from 'vitest';
import type { Friend } from '../net/types.ts';
import { lastSeen, presenceLine, sortFriends } from '../routes/friend-bits.ts';

/* The pure half of the friends list: the order it reads in and what each row
   says. Both are shared by the home card and the friends page, so a change to
   either has to be a change to one thing. */

const NOW = Date.parse('2026-09-09T12:00:00Z');

function friend(over: Partial<Friend> & { name: string }): Friend {
  return {
    id: over.name.toLowerCase(),
    country: null,
    avatarV: 0,
    rating: 1500,
    mode: 'heads-up',
    online: false,
    playing: null,
    lastSeenAt: new Date(NOW).toISOString(),
    ...over,
  };
}

describe('sortFriends', () => {
  it('puts whoever is here first, playing before idle', () => {
    const rows = sortFriends([
      friend({ name: 'Away' }),
      friend({ name: 'Idle', online: true }),
      friend({ name: 'Dealt', online: true, playing: 'm1' }),
    ]);
    expect(rows.map((f) => f.name)).toEqual(['Dealt', 'Idle', 'Away']);
  });

  it('orders everybody offline by when they were last here', () => {
    const rows = sortFriends([
      friend({ name: 'Ages', lastSeenAt: new Date(NOW - 86_400_000).toISOString() }),
      friend({ name: 'Recent', lastSeenAt: new Date(NOW - 60_000).toISOString() }),
    ]);
    expect(rows.map((f) => f.name)).toEqual(['Recent', 'Ages']);
  });

  it('breaks a tie by name, so two renders cannot disagree', () => {
    const rows = sortFriends([
      friend({ name: 'Bella', online: true }),
      friend({ name: 'Ansel', online: true }),
    ]);
    expect(rows.map((f) => f.name)).toEqual(['Ansel', 'Bella']);
  });

  it('leaves the list it was given alone', () => {
    const given = [friend({ name: 'Second', online: true }), friend({ name: 'First', online: true })];
    sortFriends(given);
    expect(given.map((f) => f.name)).toEqual(['Second', 'First']);
  });
});

describe('presenceLine', () => {
  it('says a friend is at your table only when it is the table you are at', () => {
    const dealt = friend({ name: 'Dealt', online: true, playing: 'm1' });
    expect(presenceLine(dealt, 'm1', NOW)).toEqual({ here: true, text: 'At your table' });
    expect(presenceLine(dealt, 'm2', NOW)).toEqual({ here: true, text: 'Playing' });
    expect(presenceLine(dealt, null, NOW)).toEqual({ here: true, text: 'Playing' });
  });

  it('is online with no table, and away with neither', () => {
    expect(presenceLine(friend({ name: 'Idle', online: true }), null, NOW).text).toBe('Online');
    const away = presenceLine(
      friend({ name: 'Away', lastSeenAt: new Date(NOW - 3 * 60_000).toISOString() }),
      null,
      NOW
    );
    expect(away.here).toBe(false);
    expect(away.text).toBe('Last here 3 min ago');
  });
});

describe('lastSeen', () => {
  it('climbs one unit at a time and never says two', () => {
    expect(lastSeen(new Date(NOW - 10_000).toISOString(), NOW)).toBe('Just left');
    expect(lastSeen(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('Last here 5 min ago');
    expect(lastSeen(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('Last here 3 hr ago');
    expect(lastSeen(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)).toBe('Last here 1 day ago');
    expect(lastSeen(new Date(NOW - 3 * 86_400_000).toISOString(), NOW)).toBe('Last here 3 days ago');
  });

  it('falls back to a date once a week has gone', () => {
    expect(lastSeen(new Date(NOW - 30 * 86_400_000).toISOString(), NOW)).toMatch(/^Last here \d/);
  });

  it('says something rather than nothing for a date it cannot read', () => {
    expect(lastSeen('not a date', NOW)).toBe('Away');
  });
});
