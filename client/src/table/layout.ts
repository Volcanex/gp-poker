/* Where each seat sits. One table draws two to six seats: heads-up keeps the
   stacked two-row felt it has always had, and three or more sit on an ellipse
   around the board. Pure, so the rotation and the slots are unit tested. */

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

export interface Slot {
  x: number; // percent across the ring's inner box, where the seat's centre goes
  y: number;
  yTight: number; // the same seat where the felt is too narrow to clear the board sideways
  ox: number; // px offset the seat's cards are dealt from: the middle of the table
  oy: number;
  half: 'top' | 'bottom';
}

/* The same x and y place the bet: the stylesheet reads them against a box
   inset by a seat, which is the same ellipse shrunk by exactly the room a seat
   takes up, so a chip always lands between its seat and the pot. */
const DEAL_PX = 26;

/* A narrow felt cannot put a seat level with the board without the two
   colliding, so on one the ellipse is pinched: no seat sits within this much
   of the middle. Three and four seats are the ones that need it, because an
   even spread puts a seat exactly on the midline. Five and six already sit
   clear of it. */
const CLEAR = 0.45;

export function slotAt(k: number, n: number): Slot {
  const a = (2 * Math.PI * k) / Math.max(1, n);
  const sx = -Math.sin(a);
  const sy = Math.cos(a);
  const pinch = n <= 4 ? CLEAR : 0;
  /* Exactly level with the board counts as the top half: four seats then read
     as one across the bottom, two up the sides and one facing you. */
  const tight = sy > 1e-6
    ? pinch + (1 - pinch) * sy
    : -(pinch + (1 - pinch) * Math.abs(sy));
  return {
    x: 50 + 50 * sx,
    y: 50 + 50 * sy,
    yTight: 50 + 50 * tight,
    ox: -DEAL_PX * sx,
    oy: -DEAL_PX * sy,
    half: sy > 1e-6 ? 'bottom' : 'top',
  };
}

/* Portrait: the same table on a phone, where an ellipse cannot work. Six seats
   on a 366 px felt leave about 120 px each, and a seat that narrow cannot hold
   a name, so the ellipse was truncating every one of them and dropping the
   avatar to make room.

   Instead the felt becomes four rows: the opponents furthest round the table at
   the top, the two either side of you under them, the board across the middle
   and your own seat across the bottom. Your cards stay the size they were, the
   board keeps the full width, and the order round the table is the one the
   ellipse used: k grows to your left.

   Row 1 is empty at three and four seats, and an empty grid row is nought
   pixels, so the same four rows draw every table. */
export interface GridSlot {
  row: number;
  col: number;
  span: number;
}

const HERO: GridSlot = { row: 4, col: 1, span: 3 };
/* One seat sits centred, two take the outer columns, three take all three. */
const FAR_COLUMNS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3] };

export function portraitSlot(k: number, n: number): GridSlot {
  if (k <= 0) return HERO;
  /* The two players either side of you sit nearest the board, on the outside,
     which is where they are on the ellipse too. */
  if (k === 1) return { row: 2, col: 1, span: 1 };
  if (k === n - 1) return { row: 2, col: 3, span: 1 };
  const far = n - 3; // the seats between your two neighbours
  const cols = FAR_COLUMNS[far] ?? FAR_COLUMNS[3];
  return { row: 1, col: cols[k - 2] ?? 2, span: 1 };
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
