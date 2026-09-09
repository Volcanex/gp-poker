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

/* ---------------------------------------------------------------- physical

   **A rack is chips, not a number redrawn.** `denominate` is greedy, so it
   answers a different question every time the figure moves: a stack of 1500
   is three five-hundreds, and betting two of it redraws all three as a dozen
   chips of five denominations. Nothing about that is followable, which was
   the complaint. So between one blind level and the next the rack is not
   recomputed at all: chips leave it and arrive in it, and what is left is
   whatever was not spent.

   The tidy-up is the blind change, and only the blind change. That is where a
   real table colours up, and by then the small chips a hand has accumulated
   are worth less than the blind anyway, so the roundest form is also the one
   worth holding. `denominate` is that form.

   Nothing here is authoritative. The number is the number, on the server and
   in the view; this decides only which discs are drawn for it, and every
   function below conserves the total exactly. */

export type Counts = ReadonlyMap<number, number>;

export function totalOf(counts: Counts): number {
  let n = 0;
  for (const [value, count] of counts) n += value * count;
  return n;
}

export function countsOf(amount: number): Counts {
  return new Map(denominate(amount).map((c) => [c.value, c.count]));
}

/* Take `amount` out of a rack, the way a person does: pay with the biggest
   chip that does not overshoot, and when nothing small enough is left, break
   the smallest chip that is too big and carry on. Every denomination divides
   into the one below it, so breaking always terminates, and a rack can always
   pay any amount it actually holds.

   Returns the rack that is left. The chips that went are the difference, and
   the caller adds the same value wherever they went. */
export function pay(counts: Counts, amount: number): Counts {
  const left = new Map(counts);
  let need = Math.max(0, Math.floor(amount));
  if (need > totalOf(left)) need = totalOf(left);

  while (need > 0) {
    const payable = DENOMINATIONS.find((d) => d <= need && (left.get(d) ?? 0) > 0);
    if (payable !== undefined) {
      left.set(payable, (left.get(payable) ?? 0) - 1);
      if (left.get(payable) === 0) left.delete(payable);
      need -= payable;
      continue;
    }
    // Nothing small enough to hand over: break the smallest chip that is too
    // big into the denomination under it and try again.
    const breakable = [...DENOMINATIONS].reverse().find((d) => d > need && (left.get(d) ?? 0) > 0);
    if (breakable === undefined) break; // cannot happen once need <= total
    const under = DENOMINATIONS[DENOMINATIONS.indexOf(breakable) + 1];
    left.set(breakable, (left.get(breakable) ?? 0) - 1);
    if (left.get(breakable) === 0) left.delete(breakable);
    left.set(under, (left.get(under) ?? 0) + breakable / under);
  }
  return left;
}

/* Put `amount` into a rack, in the roundest chips it can be made of. What
   arrives is what a dealer pushes across: nobody is handed forty ones. */
export function receive(counts: Counts, amount: number): Counts {
  const next = new Map(counts);
  for (const { value, count } of denominate(amount)) {
    next.set(value, (next.get(value) ?? 0) + count);
  }
  return next;
}

/* The rack after the figure beside it has moved to `amount`, keeping the
   chips that did not have to go anywhere. */
export function settle(counts: Counts, amount: number): Counts {
  const held = totalOf(counts);
  const want = Math.max(0, Math.floor(amount));
  if (want === held) return counts;
  return want < held ? pay(counts, held - want) : receive(counts, want - held);
}

/* How many discs a rack is actually holding. A rack that has drifted past
   what the felt can draw is one nobody can read anyway, so the component
   tidies it early rather than stacking chips off the top of the seat. */
export function chipCount(counts: Counts): number {
  let n = 0;
  for (const count of counts.values()) n += count;
  return n;
}
