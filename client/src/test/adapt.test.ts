import { describe, expect, it } from 'vitest';
import { handAccuracy, matchHasAccuracy, profileAccuracy, profileMatchCount } from '../net/adapt.ts';
import type { Match, MatchHandSummary, Profile } from '../net/types.ts';

const profile = (extra: Partial<Profile>): Profile => ({
  summary: { id: 'u1', name: 'kestrel', guest: false, rating: 1541, rd: 79, provisional: false },
  peak: 1541,
  peakAt: null,
  provisional: false,
  winRate: 0.5,
  ratingHistory: [],
  stats: { hands: 0, vpip: 0, pfr: 0, aggressionFrequency: 0, foldTo3bet: 0 },
  lastMatches: [],
  ...extra,
});

const hand = (accuracy: MatchHandSummary['accuracy']): MatchHandSummary => ({
  number: 1,
  completedAt: '2026-09-06T14:04:00.000Z',
  seedHash: 'a'.repeat(64),
  seed: 'b'.repeat(64),
  board: [],
  stacks: [200, 200],
  awards: null,
  accuracy,
});

const match = (hands: MatchHandSummary[]): Match => ({
  id: 'm1',
  format: { hands: 25, stack: 200, sb: 1, bb: 2, clockMs: 20000, graceMs: 15000 },
  rated: true,
  seats: [
    { seat: 0, userId: 'u1', name: 'kestrel' },
    { seat: 1, userId: 'u2', name: 'riverrat' },
  ],
  status: 'finished',
  winner: 'u1',
  reason: 'bust',
  handsPlayed: hands.length,
  finalStacks: null,
  ratings: null,
  createdAt: '2026-09-06T14:00:00.000Z',
  finishedAt: '2026-09-06T14:19:00.000Z',
  hands,
});

/* These fields are not on the server yet, so the adapter's whole job is to say
   "no number" for every shape that is not one. */
describe('pending server fields', () => {
  it('reads nothing when the field is absent, null, or not a number', () => {
    expect(profileAccuracy(profile({}))).toBeNull();
    expect(profileAccuracy(profile({ accuracy: null }))).toBeNull();
    expect(profileAccuracy(profile({ accuracy: Number.NaN }))).toBeNull();
    expect(profileMatchCount(profile({}))).toBeNull();
  });

  it('reads the value when it is there, including zero', () => {
    expect(profileAccuracy(profile({ accuracy: 0 }))).toBe(0);
    expect(profileAccuracy(profile({ accuracy: 88.9 }))).toBe(88.9);
    expect(profileMatchCount(profile({ matches: 214 }))).toBe(214);
  });

  it('takes per-seat accuracy keyed by seat or indexed by seat', () => {
    expect(handAccuracy(hand({ 0: 88.9, 1: 100 }), 0)).toBe(88.9);
    expect(handAccuracy(hand([88.9, 100]), 1)).toBe(100);
    expect(handAccuracy(hand({ 0: 88.9 }), 1)).toBeNull();
    expect(handAccuracy(hand(null), 0)).toBeNull();
    expect(handAccuracy(hand(undefined), 0)).toBeNull();
  });

  it('shows the column only once some hand carries a number for some seat', () => {
    expect(matchHasAccuracy(match([hand(null), hand(undefined)]))).toBe(false);
    expect(matchHasAccuracy(match([hand(null), hand({ 1: 74 })]))).toBe(true);
    expect(matchHasAccuracy(match([]))).toBe(false);
  });
});
