/* One finished match, read back from the seat outwards: what each player at
   it actually did, not what they typically do. `insights.ts` answers "how
   does this player play", replaying a player's whole history in one mode;
   this answers "how did this table play", replaying only this match's hands
   for every seat that sat at it. Same engine replay underneath
   (`computeInsights` and `computeRawRates`), so the betting rules are never
   duplicated and the two pages can never quietly disagree about a hand.

   A six-max match is commonly under fifty hands total, split six ways by
   elimination order, so most seats never reach MIN_INSIGHT_HANDS on their
   own. `computeInsights` is asked anyway and is trusted completely: below
   the floor it returns null groups, and this file never second-guesses that
   by lowering the floor for a match page. What it adds instead is
   `raw` (`computeRawRates`), the same fold with no floor and no rounding
   trick, printed as a count either side of a divide. A card can say "voluntarily
   played 3 of 9 hands" honestly at nine hands; it cannot say "33% VPIP" and
   mean anything by it, which is exactly the distinction computeInsights
   already draws for a whole career and this file draws for one sitting. */

import { computeInsights, computeRawRates, MIN_INSIGHT_HANDS, type Insights, type InsightHand, type InsightMatch, type RawRates } from './insights.js';
import { handBlinds, matchResultForUser, type HandRow, type MatchRow } from './db.js';
import type { Mode } from '@opentable/protocol';

export interface AccuracySummary {
  mean: number | null;
  hands: number;
}

export interface ChipPoint {
  // The hand this stack was entered with, or one past the last hand for the
  // stack the match ended on.
  hand: number;
  chips: number;
  final?: boolean;
}

export interface SeatReview {
  seat: number;
  userId: string;
  name: string;
  bot: boolean;
  avatarV: number;
  place: number | null;
  finalStack: number | null;
  result: 'win' | 'loss' | 'draw';
  insights: Insights;
  raw: RawRates;
  // Null when the mode stores no preflop study at all (six-max), not when a
  // player simply never faced a scoreable spot: see matchHasStudy below.
  accuracy: AccuracySummary | null;
  chips: ChipPoint[];
}

export interface MatchReview {
  matchId: string;
  mode: Mode;
  hands: number;
  minHands: number;
  seats: SeatReview[];
}

function toInsightHand(hand: HandRow, match: MatchRow, seat: number): InsightHand | null {
  if (hand.completedAt === null || hand.seed === null) return null;
  const { sb, bb } = handBlinds(hand, match.format);
  return {
    id: hand.id,
    matchId: hand.matchId,
    number: hand.number,
    seat,
    seed: hand.seed,
    button: hand.button,
    sb,
    bb,
    stacksStart: hand.stacksStart,
    // A hand written before the engine/table seat map existed was heads-up,
    // where the two spaces are the same thing, exactly as getInsightHandsForUser
    // reads it in db.ts.
    liveSeats: hand.liveSeats ?? hand.stacksStart.map((_, i) => i),
    actions: hand.actions,
    startedAt: hand.startedAt,
    completedAt: hand.completedAt,
  };
}

/* Preflop study is written for heads-up hands only (handRunner.ts). A
   six-max match has `study: null` on every one of its hands, which is a
   different fact from "this player never had a scoreable decision": the
   first means the number does not exist here, the second means it does and
   reads zero-for-zero. Collapsing them would let a six-max card print
   "no data" and a heads-up card with an empty sample print the same words
   for a different reason. */
function matchHasStudy(hands: HandRow[]): boolean {
  return hands.some((h) => h.study !== null);
}

function accuracyFor(hands: HandRow[], seat: number): AccuracySummary {
  let sum = 0;
  let n = 0;
  for (const h of hands) {
    const study = h.study?.[seat];
    // A hand with no scoreable decision summarises to a vacuous 100
    // (summarise() in @opentable/preflop): counted in, it would drag the
    // mean up toward a number nobody earned, the same reason
    // getUserPreflopAccuracy filters it out on a profile.
    if (!study || study.summary.count === 0) continue;
    sum += study.summary.accuracy;
    n += 1;
  }
  return { mean: n > 0 ? Math.round((sum / n) * 10) / 10 : null, hands: n };
}

function chipsFor(hands: HandRow[], seat: number, finalStack: number | null): ChipPoint[] {
  const points: ChipPoint[] = hands
    .filter((h) => h.completedAt !== null)
    .map((h) => ({ hand: h.number, chips: h.stacksStart[seat] ?? 0 }));
  if (finalStack !== null && points.length > 0) {
    points.push({ hand: points[points.length - 1].hand + 1, chips: finalStack, final: true });
  }
  return points;
}

export function computeMatchReview(match: MatchRow, hands: HandRow[]): MatchReview {
  const mode: Mode = match.format.mode ?? 'heads-up';
  const withStudy = matchHasStudy(hands);
  const completedHands = hands.filter((h) => h.completedAt !== null).length;

  const seats: SeatReview[] = match.seats.map((seat) => {
    const insightHands = hands
      .map((h) => toInsightHand(h, match, seat.seat))
      .filter((h): h is InsightHand => h !== null);
    const result = matchResultForUser(match, seat.userId);
    const insightMatch: InsightMatch = { id: match.id, result, finishedAt: match.finishedAt };
    const input = { mode, hands: insightHands, matches: [insightMatch] };

    return {
      seat: seat.seat,
      userId: seat.userId,
      name: seat.name,
      bot: seat.bot === true,
      avatarV: seat.avatarV ?? 0,
      place: match.places?.[seat.userId] ?? null,
      finalStack: match.finalStacks?.[seat.userId] ?? null,
      result,
      insights: computeInsights(input),
      raw: computeRawRates(input),
      accuracy: withStudy ? accuracyFor(hands, seat.seat) : null,
      chips: chipsFor(hands, seat.seat, match.finalStacks?.[seat.userId] ?? null),
    };
  });

  return {
    matchId: match.id,
    mode,
    hands: completedHands,
    minHands: MIN_INSIGHT_HANDS,
    seats,
  };
}
