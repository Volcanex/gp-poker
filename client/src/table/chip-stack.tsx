import { DENOMINATIONS, denominate } from './chips.ts';

const MAX_VISIBLE = 10;

export interface ChipStackProps {
  amount: number;
  /* How many denominations to draw, highest first. The mini stack beside a
     player's own number takes the big three: that is what says deep or short
     at a glance, and the ones and fives are noise at that size. */
  columns?: number;
}

/* Bespoke: g has no chip. One column per denomination, highest first, chips
   overlapping upwards by 3 px, ten to a column and then a count, which greedy
   denomination never reaches on a table this size but a bigger one would.

   **Every denomination keeps its slot whether or not there is a chip in it**,
   and a column is a fixed height with its chips on the floor. So the row is
   the same size at 0 and at 1200, a chip appears where that denomination has
   always been, and none of it moves the felt around it. A centred group whose
   membership changes moves every member; that was the whole bug. */
export function ChipStack({ amount, columns }: ChipStackProps) {
  const counts = new Map(denominate(amount).map((c) => [c.value, c.count]));
  const slots = DENOMINATIONS.slice(0, columns ?? DENOMINATIONS.length);

  return (
    <span className="chips" aria-hidden="true">
      {slots.map((value) => {
        const count = counts.get(value) ?? 0;
        const visible = Math.min(count, MAX_VISIBLE);
        return (
          <span className="chip-col" key={value}>
            {Array.from({ length: visible }, (_, i) => (
              <span className="chip" key={i} data-d={value} style={{ bottom: `${i * 3}px` }} />
            ))}
            {count > MAX_VISIBLE && <span className="chip-more num">{count}</span>}
          </span>
        );
      })}
    </span>
  );
}
