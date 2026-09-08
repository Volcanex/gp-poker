/* Where each seat sits. One geometry draws two to six seats: the opponents in
   two columns either side of the board, going round the table from your left,
   and you in the band along the bottom. Pure, so the rotation and the places
   are unit tested rather than eyeballed. */

/* Kept for the chat panel's placement rules (../chat/chat.css keys on it):
   the felt itself no longer draws two shapes. */
export type LayoutMode = 'stack' | 'ring';

export function layoutMode(seatCount: number): LayoutMode {
  return seatCount > 2 ? 'ring' : 'stack';
}

/* The viewer takes the bottom slot and the rest follow in seat order, so the
   player on your left, the next to act, is the next one round to the left.
   Watching, seat 0 takes the bottom, so the same match reads the same way
   round every time it is opened. */
export function seatOrder<T extends { i: number }>(seats: T[], you: number | null): T[] {
  const sorted = [...seats].sort((a, b) => a.i - b.i);
  const at = you == null ? -1 : sorted.findIndex((s) => s.i === you);
  const start = at < 0 ? 0 : at;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/* Three rows a column, which is what six seats need: three up the left and
   two down the right. */
export const COLUMN_ROWS = 3;

export interface Place {
  col: 'left' | 'right';
  row: number; // 1 is the top of the column
}

/* How the opponents divide: the left column takes the odd one out, so
   heads-up the single opponent is on the left and six-max is three and two. */
export function columnSizes(seatCount: number): { left: number; right: number } {
  const others = Math.max(0, seatCount - 1);
  return { left: Math.ceil(others / 2), right: Math.floor(others / 2) };
}

/* Round the table from your left: k=1 is the bottom of the left column, the
   column is climbed, then the right column is descended back towards you. A
   column's seats are packed to its top, so heads-up the one opponent sits at
   the top of the left column, level with the board. k=0 is you and has no
   place here: the band is your seat. */
export function placeOf(k: number, seatCount: number): Place | null {
  if (k <= 0 || k >= seatCount) return null;
  const { left } = columnSizes(seatCount);
  if (k <= left) return { col: 'left', row: left - k + 1 };
  return { col: 'right', row: k - left };
}

/* Cards are dealt from the middle of the table: a left seat's come in from
   its right, a right seat's from its left, and yours from above. */
const DEAL_PX = 26;

export function dealFrom(place: Place | null): { x: number; y: number } {
  if (!place) return { x: 0, y: -DEAL_PX };
  return { x: place.col === 'left' ? DEAL_PX : -DEAL_PX, y: 0 };
}

/* Deal order: round robin from the seat left of the button, one card each and
   then the second, which is the order the engine deals in. Seats with no cards
   (eliminated, or sitting out the hand) are skipped rather than left a gap. */
export function dealOrder(seats: { i: number; cards: unknown }[], button: number): Map<number, number> {
  const live = seats.filter((s) => s.cards != null).map((s) => s.i).sort((a, b) => a - b);
  const order = new Map<number, number>();
  if (live.length === 0) return order;
  const first = live.findIndex((i) => i > button);
  const start = first < 0 ? 0 : first;
  live.forEach((_, k) => order.set(live[(start + k) % live.length], k));
  return order;
}
