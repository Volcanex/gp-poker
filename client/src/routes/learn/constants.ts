import { DEFAULTS, isProvisional } from '@opentable/rating';

/* Numbers the lessons quote, read out of the code that uses them rather than
   typed into the copy. A lesson that hard-codes a constant is a lesson that
   goes quietly wrong the day the constant moves. */

export function secs(ms: number): number {
  return Math.round(ms / 1000);
}

/* isProvisional keeps its threshold as a literal inside the function, so it
   is read back out by asking the function rather than copied. The loop runs
   once at module load over 351 integers. */
export const PROVISIONAL_RD = (() => {
  for (let rd = 0; rd <= DEFAULTS.rd; rd++) {
    if (isProvisional({ rating: DEFAULTS.rating, rd, volatility: DEFAULTS.volatility })) return rd - 1;
  }
  return DEFAULTS.rd;
})();

export const START_RATING = DEFAULTS.rating;
export const START_RD = DEFAULTS.rd;
