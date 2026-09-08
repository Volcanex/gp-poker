/* The heat ramp a number on the grid is shaded with.

   It lives here rather than in hand-grid.tsx because it is arithmetic with no
   React in it, which is what makes it testable and what lets the legend
   swatches be drawn from exactly the same numbers as the cells they explain. A
   legend built by eye drifts from its grid the first time a cap moves.

   The entrance the grid arrives with is not here: it is shared with the
   preflop puzzle's chart, which has no ramp at all, so it lives in
   ../ui/grid-entrance.ts. */

/* How far up the ramp a cell may go, as a percentage of the hue mixed into the
   surface. Not a taste decision: past this the cell text stops clearing 4.5 to
   1, and the cells are ten pixel numbers. Measured in oklab against
   --text-primary on --surface-2 in both themes, the worst case being dark,
   where every chart colour is lighter than the ground it sits on:

     sequential at 70   4.79 dark (blue end), 6.59 light (magenta end)
     diverging  at 54   4.56 dark (green end), 6.97 light (red end)

   The diverging pair has to stop earlier because --ok-text and --danger-text
   are near their scale's top in dark, where a chart colour is mid scale. */
export const HEAT_CAP = 70;
export const DIVERGE_CAP = 54;

/* A linear mix spends four fifths of its ink above the halfway point, so a
   grid of mostly small numbers reads as empty with a few hot cells on it. The
   gamma pushes the bottom of the ramp up, so a quarter of the way up looks
   like a quarter of the way up. */
const GAMMA = 0.65;

/* The coolest a hand inside a painted range is allowed to be. Zero is the
   surface, and on a grid where the ramp only covers the selected cells an
   unshaded selected cell is indistinguishable from an empty one. The opening
   explorer shades every cell and wants a true zero, so it does not use this. */
export const RANGE_FLOOR = 0.25;

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

/* A value from 0 to 1, as the percentage of the ramp hue to mix into the
   surface. Zero is the bare surface; `cap` is as hot as the ramp gets. */
export function rampFill(t: number, cap = HEAT_CAP): number {
  return cap * clamp01(t) ** GAMMA;
}

/* A value from 0 to 1, as the percentage of the way from the ramp's cool hue
   to its hot one. Kept linear: the hue travel is what stops a heatmap reading
   as one colour, and bending it would crowd the hues at one end. */
export function rampHue(t: number): number {
  return 100 * clamp01(t);
}

/* Where a hand sits inside the top slice of the ranking, as a value for the
   ramp: 1 for the very best hand, falling to the floor at the hand that only
   just made the cut. */
export function rangeHeat(percentile: number, top: number): number {
  if (top <= 0) return 1;
  const early = clamp01(1 - percentile / top);
  return RANGE_FLOOR + (1 - RANGE_FLOOR) * early;
}
