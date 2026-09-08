/* The entrance for a square grid of cells: they arrive in a wave that radiates
   out from the middle rather than filling in row by row.

   It lives here, not beside either grid that uses it, because there are two of
   them and they have nothing else in common. The range explorer and the opening
   explorer share `tools/hand-grid.tsx`; the preflop puzzle draws its own chart
   from its own data. What they share is only this: 169 boxes that should read
   as one thing arriving, not as a list being filled in.

   The cells are animated imperatively on whatever elements the caller already
   renders, so nothing about their markup, focus handling or shading has to
   change to gain an entrance, and only opacity and a transform are ever
   touched. A grid that animated its width would push whatever sits beside it
   around 169 times. */

import { useLayoutEffect, useRef } from 'react';
import { useAnimate, useReducedMotion } from 'motion/react';

export const GRID_SIZE = 13;

/* One cell's fade, and how long the wave takes to reach a corner from the
   middle. The two add up to the whole entrance: 520ms, which is inside g's
   slow duration times three and well short of the point where an entrance
   starts feeling like a page load. */
export const CELL_ENTER = 0.16;
export const WAVE_SPAN = 0.36;

/* Cells come in a shade smaller. */
export const ENTER_SCALE = 0.84;

/* A run of wave changes settles into one entrance rather than sixty: a dragged
   slider fires a change per step, and each would otherwise blank the grid and
   start over under the pointer. The first wave, on mount, does not wait. */
const SETTLE = 120;

const CENTRE = (GRID_SIZE - 1) / 2;
const REACH = Math.hypot(CENTRE, CENTRE);

/* Seconds before the cell at (row, col) starts, straight line distance from the
   middle of the grid. Radial rather than row major, which is the whole point:
   a wave that runs left to right reads as a list being filled in, one that
   radiates reads as the grid arriving at once. */
export function centreDelay(row: number, col: number): number {
  const d = Math.hypot(row - CENTRE, col - CENTRE);
  return (d / REACH) * WAVE_SPAN;
}

export interface GridEntranceOptions {
  /* Every element matching this inside the scope is a cell, and each must
     carry data-r and data-c. */
  selector: string;
  /* Bump it whenever the whole grid means something new. Leave it out on a
     grid that mounts fresh for each new meaning, which then enters once. */
  wave?: string | number;
}

/* Returns the ref to put on the element that contains the cells. */
export function useGridEntrance<T extends HTMLElement>({ selector, wave }: GridEntranceOptions) {
  const [scope, animate] = useAnimate<T>();
  const reduced = useReducedMotion();
  const mounted = useRef(false);

  /* Laid out before paint, so the first frame is the hidden one rather than a
     whole grid flashing in and back out. */
  useLayoutEffect(() => {
    const cells = () => scope.current?.querySelectorAll<HTMLElement>(selector) ?? [];
    if (reduced) {
      /* The setting can be turned on while a wave is in flight, and a cell the
         animation never finished would be left at nothing. */
      for (const node of cells()) {
        node.style.removeProperty('opacity');
        node.style.removeProperty('transform');
      }
      return undefined;
    }
    const run = () => {
      const nodes = cells();
      for (const node of nodes) {
        node.style.opacity = '0';
        node.style.transform = `scale(${ENTER_SCALE})`;
      }
      for (const node of nodes) {
        animate(
          node,
          { opacity: [0, 1], scale: [ENTER_SCALE, 1] },
          {
            duration: CELL_ENTER,
            ease: [0.2, 0, 0, 1],
            delay: centreDelay(Number(node.dataset.r), Number(node.dataset.c)),
          },
        );
      }
    };
    if (!mounted.current) {
      mounted.current = true;
      run();
      return undefined;
    }
    const timer = setTimeout(run, SETTLE);
    return () => clearTimeout(timer);
  }, [wave, reduced, animate, scope, selector]);

  return scope;
}
