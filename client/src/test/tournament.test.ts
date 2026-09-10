import { describe, expect, it } from 'vitest';
import type { TournamentTable } from '@opentable/protocol';
import {
  entrantsLabel,
  isBracket,
  localStart,
  progressLabel,
  roundName,
  seatOutcome,
  shapeLabel,
  tournamentClock,
  tournamentCountdown,
} from '../routes/tournament-bits.ts';

/* The pure half of the tournament pages. What is worth pinning here is the
   arithmetic nobody would notice was wrong: a countdown that reads the same at
   two different moments, a round that calls itself the final when it is not,
   and a table that prints a place before it has one. */

const START = Date.UTC(2026, 8, 13, 18, 0, 0);

function table(over: Partial<TournamentTable> = {}): TournamentTable {
  return {
    round: 1,
    table: 0,
    status: 'pending',
    matchId: null,
    bye: false,
    advance: 2,
    seats: [],
    ...over,
  };
}

describe('the tournament clock', () => {
  it('counts an upcoming fixture down and says when it is starting', () => {
    const upcoming = { status: 'upcoming' as const, startsAt: new Date(START).toISOString() };
    expect(tournamentClock(upcoming, START - 90 * 60_000)).toEqual({
      kind: 'starts',
      label: 'Starts in 1 hr 30 min',
    });
    expect(tournamentClock(upcoming, START - 2 * 60 * 60_000).label).toBe('Starts in 2 hr');
    expect(tournamentClock(upcoming, START - 5 * 60_000).label).toBe('Starts in 5 min');
    expect(tournamentClock(upcoming, START - 30_000).label).toBe('Starts in 30 sec');
    expect(tournamentClock(upcoming, START)).toEqual({ kind: 'starts', label: 'Starting now' });
    // Never a negative countdown: past its own start and still upcoming is a
    // fixture the scheduler has not reached yet, not one that is late.
    expect(tournamentClock(upcoming, START + 60_000).label).toBe('Starting now');
  });

  it('says a running fixture is playing rather than counting anything', () => {
    // A tournament ends when its final table settles, not when a clock says it
    // should have, so there is nothing left to count.
    const running = { status: 'running' as const, startsAt: new Date(START).toISOString() };
    expect(tournamentClock(running, START + 3 * 60 * 60_000)).toEqual({
      kind: 'playing',
      label: 'Playing now',
    });
  });

  it('reads a settled fixture off its status', () => {
    const at = new Date(START).toISOString();
    expect(tournamentClock({ status: 'finished', startsAt: at }, START).kind).toBe('over');
    expect(tournamentClock({ status: 'cancelled', startsAt: at }, START)).toEqual({
      kind: 'cancelled',
      label: 'Cancelled',
    });
  });
});

describe('what a card says', () => {
  it('reads the field as a count over its cap only while there are seats', () => {
    expect(entrantsLabel({ entrants: 0, seats: 32 })).toBe('0 of 32 entered');
    expect(entrantsLabel({ entrants: 32, seats: 32, status: 'upcoming' })).toBe('32 of 32 entered');
    // A started fixture's cap is no longer a fact about it.
    expect(entrantsLabel({ entrants: 13, seats: 36, status: 'running' })).toBe('13 entrants');
    expect(entrantsLabel({ entrants: 1, seats: 36, status: 'finished' })).toBe('1 entrant');
  });

  it('counts a fixture a month out in days rather than in hours', () => {
    // The arena's own countdown tops out at hours, which is right for an event
    // inside the hour and unreadable for one four weeks away.
    expect(tournamentCountdown(594 * 60 * 60_000)).toBe('25 days');
    expect(tournamentCountdown(90 * 60 * 60_000)).toBe('4 days');
    expect(tournamentCountdown(20 * 60 * 60_000)).toBe('20 hr');
    expect(tournamentCountdown(90 * 60_000)).toBe('1 hr 30 min');
    expect(tournamentCountdown(-5)).toBe('0 sec');
  });

  it('names a shape without naming a fixture', () => {
    expect(shapeLabel('bracket')).toBe('Heads-up bracket');
    expect(shapeLabel('shootout')).toBe('Six-max shootout');
    expect(isBracket('bracket')).toBe(true);
    expect(isBracket('shootout')).toBe(false);
  });

  it("prints a start time in the viewer's own zone, with the day", () => {
    const label = localStart(new Date(START).toISOString());
    // The zone is the machine's, so the hour is not assertable; the shape is.
    expect(label).toMatch(/\d/);
    expect(label.length).toBeGreaterThan(8);
    expect(localStart('not a date')).toBe('');
  });
});

describe('naming a round', () => {
  it('calls one table the final and two the semi-finals', () => {
    const rounds = [
      [table(), table(), table(), table()],
      [table({ round: 2 }), table({ round: 2 })],
      [table({ round: 3 })],
    ];
    expect(roundName(rounds, 1)).toBe('Round 1 of 3');
    expect(roundName(rounds, 2)).toBe('Semi-finals');
    expect(roundName(rounds, 3)).toBe('Final');
  });

  it('does not claim a depth a shootout has not reached', () => {
    // A running shootout's rounds are only the ones played so far, so the
    // current round cannot say what it is out of.
    const rounds = [[table(), table(), table()]];
    expect(roundName(rounds, 1)).toBe('Round 1');
  });

  it('says what to do before the start and what happened after', () => {
    const rounds = [
      [table(), table(), table(), table()],
      [table({ round: 2 }), table({ round: 2 })],
      [table({ round: 3 })],
    ];
    expect(progressLabel({ status: 'upcoming', round: 0, rounds: [] })).toBe('Registration open');
    expect(progressLabel({ status: 'cancelled', round: 0, rounds: [] })).toBe('Not enough entrants');
    expect(progressLabel({ status: 'finished', round: 3, rounds })).toBe('Finished');
    expect(progressLabel({ status: 'running', round: 1, rounds })).toBe('Round 1 of 3');
    expect(progressLabel({ status: 'running', round: 3, rounds })).toBe('Final');
  });
});

describe('a seat and a band', () => {
  it('says nothing about a place a table has not decided', () => {
    expect(seatOutcome({ place: null, advanced: false })).toBeNull();
    expect(seatOutcome({ place: 1, advanced: true })).toBe('1, through');
    expect(seatOutcome({ place: 4, advanced: false })).toBe('4');
  });
});
