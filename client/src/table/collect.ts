import type { Street } from '@opentable/protocol';

/* When the pot has to collect before the next street is dealt.

   The engine deals the next street inside the action that closes the betting
   (`afterAction` in `@opentable/engine`), so one frame of the wire carries
   both the caller's chips and the flop: the pot's rack was still ticking up
   while the cards were landing on top of it. Tickets g7hfddbc and d62s9bgx
   are the same report twice, two days apart.

   Pure and on its own so `../test/table.test.ts` can test the rule without a
   felt, the way `sitout.ts` is. What the felt does with the answer is in
   `table.tsx`. */

export interface Dealt {
  h: number; // hand number: a new hand is not a new street
  board: number; // cards the board holds
  pot: number;
  street: Street;
  runout: boolean; // a paced all-in run-out is dealing the board itself
}

export function potCollects(prev: Dealt | null, next: Dealt): boolean {
  if (prev === null || prev.h !== next.h) return false;
  // Nothing to wait for: a street everybody checked through moves no chips,
  // and a beat in which nothing moves is a beat.
  if (next.pot <= prev.pot) return false;
  if (next.board <= prev.board) return false;
  /* The hand is over. Its own three-step sequence owns the felt from here
     (see `table.tsx`), and a table that is all in has already put its chips
     in the middle. */
  if (next.street === 'done') return false;
  // The server is already pacing the board a street a beat, and the betting
  // it is running out finished streets ago.
  if (next.runout || prev.runout) return false;
  return true;
}
