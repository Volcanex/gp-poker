/* A countdown, as numbers rather than as sound: which seconds tick and how
   high each one sits. Pure and unit tested, because "the ticks climb" is the
   kind of rule that is easy to write and impossible to hear a mistake in.

   The last ten seconds tick, one a second. Each is a little higher than the
   one before it: the first sits at the sample's own pitch and the last about
   a fifth above it, which reads as pressure rather than as a tune. The rise
   is playback rate, so the sample shortens as it climbs, which is what
   urgency does to a sound in the world as well. */

export const COUNTDOWN_FROM = 10;

/* Per second of the countdown. Ten steps of this from 1.0 land the last tick
   at 1.45, a little under a fifth, which is as far as the same sample can be
   stretched before it stops sounding like itself. */
const RATE_STEP = 0.05;

/* The rate to play the tick at with this many seconds left, or null when this
   second gets no tick at all: before the countdown starts, and once it has
   run out. Rounded, so the rate for a given second is one number rather than
   a float that differs in its last place between two callers. */
export function countdownRate(secondsLeft: number): number | null {
  if (!Number.isFinite(secondsLeft)) return null;
  const left = Math.round(secondsLeft);
  if (left < 1 || left > COUNTDOWN_FROM) return null;
  return Number((1 + (COUNTDOWN_FROM - left) * RATE_STEP).toFixed(2));
}
