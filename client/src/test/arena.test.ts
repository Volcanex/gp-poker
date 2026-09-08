import { describe, expect, it } from 'vitest';
import type { ArenaStanding } from '@opentable/protocol';
import {
  arenaCardLine,
  arenaClock,
  boardRows,
  countdown,
  onFire,
  podiumLabel,
  record,
} from '../routes/arena-bits.ts';

const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);
const at = (ms: number) => new Date(NOW + ms).toISOString();

function standing(over: Partial<ArenaStanding> & { uid: string; rank: number }): ArenaStanding {
  return {
    name: over.uid,
    bot: false,
    rating: 1500,
    score: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    matches: 0,
    paused: false,
    ...over,
  };
}

describe('the arena countdown', () => {
  it('counts in the largest unit that still says something', () => {
    expect(countdown(40_000)).toBe('40 sec');
    expect(countdown(12 * 60_000)).toBe('12 min');
    expect(countdown(60 * 60_000)).toBe('1 hr');
    expect(countdown(65 * 60_000)).toBe('1 hr 5 min');
    expect(countdown(-5_000)).toBe('0 sec');
  });

  it('counts down to the start, then to the end', () => {
    const upcoming = { status: 'upcoming' as const, startsAt: at(12 * 60_000), endsAt: at(42 * 60_000) };
    expect(arenaClock(upcoming, NOW)).toEqual({ kind: 'starts', label: 'Starts in 12 min' });

    const running = { status: 'running' as const, startsAt: at(-7 * 60_000), endsAt: at(23 * 60_000) };
    expect(arenaClock(running, NOW)).toEqual({ kind: 'ends', label: '23 min left' });
  });

  it('says an arena past its clock is settling, not over', () => {
    const settling = { status: 'running' as const, startsAt: at(-31 * 60_000), endsAt: at(-60_000) };
    expect(arenaClock(settling, NOW)).toEqual({ kind: 'settling', label: 'Finishing the last matches' });
  });

  it('never counts into the negative before the status has caught up', () => {
    const due = { status: 'upcoming' as const, startsAt: at(-1_000), endsAt: at(29 * 60_000) };
    expect(arenaClock(due, NOW).label).toBe('Starting now');
  });

  it('reads finished as finished whatever the clock says', () => {
    const done = { status: 'finished' as const, startsAt: at(-90 * 60_000), endsAt: at(-60 * 60_000) };
    expect(arenaClock(done, NOW)).toEqual({ kind: 'over', label: 'Finished' });
  });

  it('writes the home page card in one line', () => {
    const upcoming = {
      status: 'upcoming' as const,
      startsAt: at(12 * 60_000),
      endsAt: at(42 * 60_000),
      players: 4,
    };
    expect(arenaCardLine(upcoming, NOW)).toBe('Starts in 12 min. 4 players joined.');
    expect(arenaCardLine({ ...upcoming, players: 1 }, NOW)).toBe('Starts in 12 min. 1 player joined.');
    expect(arenaCardLine(null, NOW)).toBe('The next arena is being scheduled.');
  });
});

describe('the arena board', () => {
  it('lights the flame once two wins are banked', () => {
    expect(onFire(0)).toBe(false);
    expect(onFire(1)).toBe(false);
    expect(onFire(2)).toBe(true);
    expect(onFire(6)).toBe(true);
  });

  it('marks the break where your own row was appended', () => {
    const rows = boardRows(
      [standing({ uid: 'a', rank: 1 }), standing({ uid: 'b', rank: 2 }), standing({ uid: 'me', rank: 41 })],
      'me'
    );
    expect(rows.map((r) => r.gap)).toEqual([false, false, true]);
    expect(rows.map((r) => r.you)).toEqual([false, false, true]);
  });

  it('draws you once when you are inside the top of the board', () => {
    const rows = boardRows([standing({ uid: 'me', rank: 1 }), standing({ uid: 'me', rank: 1 })], 'me');
    expect(rows).toHaveLength(1);
    expect(rows[0].gap).toBe(false);
  });

  it('reads a record as one column', () => {
    expect(record(standing({ uid: 'a', rank: 1, wins: 5, draws: 1, losses: 2 }))).toBe('5/1/2');
  });

  it('names the three places on a podium', () => {
    expect([1, 2, 3].map(podiumLabel)).toEqual(['First', 'Second', 'Third']);
    expect(podiumLabel(4)).toBe('Place 4');
  });
});
