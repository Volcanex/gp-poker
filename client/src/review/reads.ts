import type { MatchRawRates } from '../net/types.ts';

/* Short, backed sentences for one seat: what a player could take from this
   sitting, each tied to the count it came from. Pure and separate from the
   card so it can be read (and tested) without a fetch. Every sentence names
   its own N; nothing here fires below the count that makes it mean
   something, which is usually lower than MIN_INSIGHT_HANDS because a single
   observation ("you never three-bet when you could have") is still a fact
   about this match even where a career rate would refuse to summarise. */
export function reads(raw: MatchRawRates): string[] {
  const out: string[] = [];

  if (raw.threeBet.of >= 2 && raw.threeBet.made === 0) {
    out.push(`Never three-bet when given the chance, ${raw.threeBet.of} times this match.`);
  }
  if (raw.vpip.of >= 6) {
    const rate = raw.vpip.made / raw.vpip.of;
    if (rate >= 0.6) {
      out.push(`Played ${raw.vpip.made} of ${raw.vpip.of} hands voluntarily, looser than most tables run.`);
    } else if (rate <= 0.12) {
      out.push(`Played only ${raw.vpip.made} of ${raw.vpip.of} hands voluntarily, tighter than most tables run.`);
    }
  }
  if (raw.aggressionFactor.of >= 3) {
    const af = raw.aggressionFactor.made / raw.aggressionFactor.of;
    if (af <= 0.4) {
      out.push(
        `Called ${raw.aggressionFactor.of} postflop bets to every ${raw.aggressionFactor.made} raised or bet, a passive line after the flop.`
      );
    }
  }
  if (raw.cbet.of >= 3 && raw.cbet.made === 0) {
    out.push(`Took the preflop raise ${raw.cbet.of} times and never continuation bet the flop.`);
  }
  return out;
}
