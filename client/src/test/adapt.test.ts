import { describe, expect, it } from 'vitest';
import { HEADS_UP_FORMAT } from '@opentable/protocol';
import type { ModeRating } from '@opentable/protocol';
import {
  handAccuracy, liveSeats, matchHasAccuracy, matchPlacing, matchRated,
  modeRating, profileAccuracy, ratingHistoryFor, startStacks,
} from '../net/adapt.ts';
import type { Hand, Match, MatchHandSummary, Profile, UserMatchSummary } from '../net/types.ts';

const standing = (rating: number, rd: number): ModeRating => ({
  rating, rd, provisional: rd > 110, peak: rating, matches: 0, wins: 0, losses: 0, draws: 0,
});

const profile = (extra: Partial<Profile>): Profile => ({
  summary: {
    id: 'u1', name: 'kestrel', guest: false, bot: false,
    rating: 1541, rd: 79, provisional: false,
    ratings: { 'heads-up': standing(1541, 79), 'six-max': standing(1500, 350) },
  },
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
  format: HEADS_UP_FORMAT,
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
  });

  it('reads the value when it is there, including zero', () => {
    expect(profileAccuracy(profile({ accuracy: 0 }))).toBe(0);
    expect(profileAccuracy(profile({ accuracy: 88.9 }))).toBe(88.9);
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

const history = (extra: Partial<UserMatchSummary>): UserMatchSummary => ({
  id: 'm1',
  opponent: 'riverrat',
  result: 'win',
  ratingChange: 12,
  finishedAt: '2026-09-06T14:19:00.000Z',
  ...extra,
});

describe('match history fields', () => {
  it('says nothing about a placing until both halves of it are there', () => {
    expect(matchPlacing(history({}))).toBeNull();
    expect(matchPlacing(history({ place: 1 }))).toBeNull();
    expect(matchPlacing(history({ players: 6 }))).toBeNull();
    expect(matchPlacing(history({ place: 0, players: 6 }))).toBeNull();
    expect(matchPlacing(history({ place: 1, players: 6 }))).toEqual({ place: 1, players: 6 });
  });

  it('leaves the casual tag off a row that does not say either way', () => {
    expect(matchRated(history({}))).toBeNull();
    expect(matchRated(history({ rated: false }))).toBe(false);
    expect(matchRated(history({ rated: true }))).toBe(true);
  });
});

const handRow = (extra: Partial<Hand>): Hand => ({
  id: 'm1-1',
  matchId: 'm1',
  number: 1,
  seats: [
    { seat: 0, userId: 'u1', name: 'kestrel' },
    { seat: 1, userId: 'u2', name: 'riverrat' },
  ],
  button: 0,
  sb: 1,
  bb: 2,
  stacksStart: [200, 200],
  seedHash: 'a'.repeat(64),
  seed: 'b'.repeat(64),
  actions: [],
  board: [],
  holes: null,
  result: null,
  stats: null,
  study: null,
  startedAt: '2026-09-06T14:02:00.000Z',
  completedAt: null,
  ...extra,
});

describe('live seats', () => {
  it('falls back to the identity, which is every heads-up hand ever written', () => {
    expect(liveSeats(handRow({}))).toEqual([0, 1]);
    expect(liveSeats(handRow({ live_seats: null }))).toEqual([0, 1]);
  });

  it('takes the map when the row carries one', () => {
    const row = handRow({ live_seats: [0, 2, 5] });
    expect(liveSeats(row)).toEqual([0, 2, 5]);
  });

  it('indexes the starting stacks by table seat only when there are more of them', () => {
    // one stack per table seat, three of the six still playing
    const perTable = handRow({ live_seats: [0, 2, 5], stacksStart: [200, 0, 340, 0, 0, 160] });
    expect(startStacks(perTable, [0, 2, 5])).toEqual([200, 340, 160]);
    // one stack per player in the hand
    const perPlayer = handRow({ live_seats: [0, 2, 5], stacksStart: [200, 340, 160] });
    expect(startStacks(perPlayer, [0, 2, 5])).toEqual([200, 340, 160]);
  });
});

describe('per-mode ratings', () => {
  const summary = profile({}).summary;

  it('reads the standing for the mode asked for', () => {
    expect(modeRating(summary, 'heads-up').rating).toBe(1541);
    expect(modeRating(summary, 'six-max').rating).toBe(1500);
    expect(modeRating(summary, 'six-max').provisional).toBe(true);
  });

  it('falls back to the flat fields for heads-up when the map is missing', () => {
    const old = { ...summary, ratings: undefined } as unknown as typeof summary;
    expect(modeRating(old, 'heads-up')).toMatchObject({ rating: 1541, rd: 79, matches: 0 });
    // Any other mode reads as never played rather than borrowing heads-up.
    expect(modeRating(old, 'six-max')).toMatchObject({ rating: 1500, rd: 350, matches: 0 });
  });

  it('takes one rating line per mode, and a flat one as heads-up', () => {
    const point = { rating: 1520, rd: 80, at: '2026-09-06T14:19:00.000Z', matchId: 'm1' };
    const keyed = profile({ ratingHistory: { 'heads-up': [point], 'six-max': [] } });
    expect(ratingHistoryFor(keyed, 'heads-up')).toHaveLength(1);
    expect(ratingHistoryFor(keyed, 'six-max')).toHaveLength(0);

    const flat = profile({ ratingHistory: [point] });
    expect(ratingHistoryFor(flat, 'heads-up')).toHaveLength(1);
    expect(ratingHistoryFor(flat, 'six-max')).toHaveLength(0);
  });
});
