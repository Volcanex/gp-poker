/* Chips that correspond to the number beside them. A player reads a stack
   before they read a figure, and a table where 137 is drawn as 137 units of
   nothing is a spreadsheet with cards on it. */

export const DENOMINATIONS = [500, 100, 25, 5, 1] as const;

export interface ChipColumn {
  value: number; // the denomination
  count: number; // how many of it
}

/* Greedy, highest first, which is how a dealer makes change and how a player
   expects to see it: 137 is a hundred, a twenty five, two fives and two ones,
   never five twenty fives and change.

   Greedy over these five also bounds a column: four ones roll into a five,
   four fives into a twenty five, three twenty fives into a hundred, four
   hundreds into a five hundred. Only the five hundreds are unbounded, and a
   table holds 1200. That is why the felt reserves five chips of height and not
   the ten the stack component will draw before it starts counting. */
export function denominate(amount: number): ChipColumn[] {
  let left = Math.floor(amount);
  if (!Number.isFinite(left) || left <= 0) return [];
  const out: ChipColumn[] = [];
  for (const value of DENOMINATIONS) {
    const count = Math.floor(left / value);
    if (count > 0) {
      out.push({ value, count });
      left -= count * value;
    }
  }
  return out;
}
