import { describe, expect, it } from 'vitest';
import type { LobbySeat } from '@opentable/protocol';
import { expiryLine, lobbyLayout, startBlurb } from '../routes/home-game-seats.ts';

function seat(name: string, host = false): LobbySeat {
  return { uid: `id-${name}`, name, rating: 1500, host };
}

describe('the home game lobby layout', () => {
  it('draws every chair the table has, taken ones first', () => {
    const { chairs, humans, bots, full } = lobbyLayout([seat('Ann', true), seat('Bo')], 6, 3);
    expect(chairs).toHaveLength(6);
    expect(humans).toBe(2);
    expect(bots).toBe(4);
    expect(full).toBe(false);
    expect(chairs.slice(0, 2).map((c) => c.kind)).toEqual(['taken', 'taken']);
    expect(chairs.slice(2).every((c) => c.kind === 'empty')).toBe(true);
  });

  it('puts the host first whatever order the seats arrived in', () => {
    const { chairs } = lobbyLayout([seat('Bo'), seat('Ann', true), seat('Cy')], 6, 2);
    const names = chairs.filter((c) => c.kind === 'taken').map((c) => (c.kind === 'taken' ? c.seat.name : ''));
    expect(names).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it('carries the level an empty chair will be filled at', () => {
    const { chairs } = lobbyLayout([seat('Ann', true)], 6, 5);
    const empty = chairs.filter((c) => c.kind === 'empty');
    expect(empty).toHaveLength(5);
    expect(empty.every((c) => c.kind === 'empty' && c.level === 5)).toBe(true);
  });

  it('is full with no bots to seat once every chair is taken', () => {
    const seats = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fi'].map((n, i) => seat(n, i === 0));
    const layout = lobbyLayout(seats, 6, 1);
    expect(layout.full).toBe(true);
    expect(layout.bots).toBe(0);
    expect(layout.chairs.every((c) => c.kind === 'taken')).toBe(true);
  });

  it('clamps a lobby that holds more people than the table seats', () => {
    const seats = ['Ann', 'Bo', 'Cy'].map((n, i) => seat(n, i === 0));
    const layout = lobbyLayout(seats, 2, 4);
    expect(layout.chairs).toHaveLength(2);
    expect(layout.humans).toBe(2);
    expect(layout.bots).toBe(0);
  });

  it('counts the link down in the unit that still says something', () => {
    const now = Date.UTC(2026, 8, 8, 12, 0, 0);
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(expiryLine(at(21 * 3600_000), now)).toBe('This link works for another 21 hours.');
    expect(expiryLine(at(3600_000), now)).toBe('This link works for another 1 hour.');
    expect(expiryLine(at(9 * 60_000), now)).toBe('This link works for another 9 minutes.');
    expect(expiryLine(at(-60_000), now)).toBe('This link has expired.');
  });

  it('says what the start button is about to do', () => {
    expect(startBlurb(2, 4, true)).toBe('2 people at the table, 4 seats filled by bots. Rated.');
    expect(startBlurb(1, 5, true)).toContain('until a second person joins');
    expect(startBlurb(3, 3, false)).toContain("nobody's rating moves");
    expect(startBlurb(6, 0, true)).toBe('6 people at the table, every seat is taken. Rated.');
  });
});
