/* The two pure parts of how the 13 by 13 grid shows a value: the heat ramp a
   number is shaded with, and the geometry of the entrance that radiates out
   from the middle of the grid.

   Both live here rather than in hand-grid.tsx because they are arithmetic with
   no React in them, which is what makes them testable and what lets the legend
   swatches be drawn from exactly the same numbers as the cells they explain.
   A legend built by eye drifts from its grid the first time the cap moves. */

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

/* ------------------------------------------------------------- entrance */

export const GRID_SIZE = 13;

/* One cell's fade, and how long the wave takes to reach a corner from the
   middle. The two add up to the whole entrance: 520ms, inside g's slow
   duration times three and well under the point where a page entrance starts
   feeling like a page load. */
export const CELL_ENTER = 0.16;
export const WAVE_SPAN = 0.36;

/* Cells come in a shade smaller. Transform only: a grid that animated its
   width would push the panel beside it around 169 times. */
export const ENTER_SCALE = 0.84;

const CENTRE = (GRID_SIZE - 1) / 2;
const REACH = Math.hypot(CENTRE, CENTRE);

/* Seconds before the cell at (row, col) starts, straight line distance from
   the middle of the grid. Radial rather than row major, which is the whole
   point: a wave that runs left to right reads as a list being filled in, one
   that radiates reads as the grid arriving at once. */
export function centreDelay(row: number, col: number): number {
  const d = Math.hypot(row - CENTRE, col - CENTRE);
  return (d / REACH) * WAVE_SPAN;
}
