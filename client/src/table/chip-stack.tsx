import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import { DENOMINATIONS, chipCount, countsOf, settle, totalOf, type Counts } from './chips.ts';
import { useLook } from './look.ts';

const MAX_VISIBLE = 10;
/* One chip per tick. Slow enough to be seen leaving, fast enough that a
   column of four is gone before the next action lands. */
export const TICK_MS = 60;


export interface ChipStackProps {
  amount: number;
  /* How many denominations to draw, highest first. The mini stack beside a
     player's own number takes the big three: that is what says deep or short
     at a glance, and the ones and fives are noise at that size. */
  columns?: number;
  /* Stand the chips over the middle of the row rather than in their slots as
     they fall. The pot asks for this and nothing else does: it is the one
     stack with a figure under it, and a pot of 3 is a single one-chip in the
     last of five reserved slots, which put the chips 44 px right of the number
     they belong to. See `shiftOf`. */
  centred?: boolean;
  /* The blind level this rack is being drawn under. **It is the only thing
     that re-lays a rack**: between one level and the next, chips leave and
     arrive and everything else stays where it is, so a bet moves the chips it
     costs rather than redrawing the stack. Changing it colours the rack up,
     which is what a real table does at a level, and by then the small chips
     are worth less than the blind anyway. Left out, the rack still holds its
     chips; it just has nothing to tidy it. */
  level?: number;
}

/* Where each column of a centred rack is drawn, counted in columns from the
   slot it was dealt. **The rack closes up and stands under the figure**: the
   denominations it is actually holding are packed side by side and the group is
   centred, so a pot of 3 is one white chip under the number rather than a chip
   marooned in the last of five slots.

   **Every column keeps its box**, and only the paint moves: the offsets are
   drawn as transforms, which the browser's layout-shift observer does not
   count, so the felt keeps the zero it has always had while the rack re-lays.
   It re-lays on the one event that already moves chips, the pot changing, so
   there is still one thing moving at a time.

   An empty slot draws nothing and its offset is nought. */
export function packOffsets(counts: Counts, slots: number[]): number[] {
  const on = slots.map((d, i) => ((counts.get(d) ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
  if (on.length === 0) return slots.map(() => 0);
  const start = (slots.length - on.length) / 2;
  return slots.map((_, i) => {
    const at = on.indexOf(i);
    return at < 0 ? 0 : start + at - i;
  });
}

function key(counts: Counts): string {
  return DENOMINATIONS.map((d) => counts.get(d) ?? 0).join(',');
}

/* The tidy form of any stack this table can hold is about seventeen discs, so
   a rack half again as messy as that has drifted past being countable and is
   tidied without waiting for a level. It is a ceiling and not the tidy-up:
   the blind change is still what colours a readable rack up. */
const MESSY = 24;

/* What the rack is holding, as opposed to what the figure beside it says.
   The two always agree on the total and rarely on the chips: that is the
   whole point, and `settle` in ./chips.ts is where the difference is made. */
function useHeld(amount: number, level: number | undefined): Counts {
  const held = useRef<Counts>(countsOf(amount));
  const at = useRef<number | undefined>(level);

  if (level !== at.current) {
    // The colour-up. Also the first render of a rack that was given a level,
    // which is the same thing: nothing has happened at this table yet.
    at.current = level;
    held.current = countsOf(amount);
  } else if (totalOf(held.current) !== amount) {
    const next = settle(held.current, amount);
    held.current = chipCount(next) > MESSY ? countsOf(amount) : next;
  }
  return held.current;
}

/* Chips leave and arrive one at a time, off the top. Every column steps one
   chip toward its target per tick until all of them are there, so a bet of
   fifty is a twenty five leaving, then another, and the pot is the same two
   chips arriving in the same two ticks. Nothing flies: a chip that has left
   one stack is the chip that has just appeared on another. The figure beside
   the stack is not this component's to animate and should snap. */
function useTicked(amount: number, on: boolean, level: number | undefined): Counts {
  const target = useHeld(amount, level);
  const targetKey = key(target);
  const shown = useRef<Counts>(target);
  const [, force] = useState(0);

  useEffect(() => {
    if (!on) {
      shown.current = target;
      force((n) => n + 1);
      return;
    }
    const step = () => {
      const next = new Map<number, number>();
      let moved = false;
      for (const d of DENOMINATIONS) {
        const have = shown.current.get(d) ?? 0;
        const want = target.get(d) ?? 0;
        const now = have === want ? have : have + Math.sign(want - have);
        if (now !== have) moved = true;
        if (now > 0) next.set(d, now);
      }
      shown.current = next;
      force((n) => n + 1);
      return moved;
    };
    if (key(shown.current) === targetKey) return;
    const timer = setInterval(() => {
      if (!step() || key(shown.current) === targetKey) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, on]);

  return on ? shown.current : target;
}

/* Bespoke: g has no chip. One column per denomination, highest first, chips
   overlapping upwards by 3 px, ten to a column and then a count, which greedy
   denomination never reaches on a table this size but a bigger one would.

   **Every denomination keeps its slot whether or not there is a chip in it**,
   and a column is a fixed height with its chips on the floor. So the row is
   the same size at 0 and at 1200, a chip appears where that denomination has
   always been, and none of it moves the felt around it. A centred group whose
   membership changes moves every member; that was the whole bug. */
export function ChipStack({ amount, columns, centred, level }: ChipStackProps) {
  const slots = DENOMINATIONS.slice(0, columns ?? DENOMINATIONS.length);
  const look = useLook();
  const reduced = useReducedMotion();
  const counts = useTicked(amount, look === 'v2' && !reduced, level);
  const packed = centred ? packOffsets(counts, slots) : null;
  const cls = centred ? 'chips chips-packed' : 'chips';
  const colStyle = (i: number) => (packed ? ({ '--dx': packed[i] } as CSSProperties) : undefined);

  /* v2: the same columns and the same reserved slots, drawn as chips. Each is
     the sprite's three-quarter chip, and a column stacks them by the height
     of the rim, so five ones is visibly a column of five. The colours are set
     on the stack in look-v2.css and read through the <use>. A chip that has
     just arrived is keyed by its place in the column, so only the top one
     mounts and takes the set-down animation. */
  if (look === 'v2') {
    return (
      <span className={cls} aria-hidden="true">
        {slots.map((value, i) => {
          const count = counts.get(value) ?? 0;
          const visible = Math.min(count, MAX_VISIBLE);
          return (
            <span className="chip-col" key={value} style={colStyle(i)}>
              {Array.from({ length: visible }, (_, i) => (
                <svg
                  className="chip"
                  key={i}
                  data-d={value}
                  viewBox="0 0 100 72"
                  style={{ '--i': i } as CSSProperties}
                >
                  <use href="#chip" />
                </svg>
              ))}
              {count > MAX_VISIBLE && <span className="chip-more num">{count}</span>}
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <span className={cls} aria-hidden="true">
      {slots.map((value, i) => {
        const count = counts.get(value) ?? 0;
        const visible = Math.min(count, MAX_VISIBLE);
        return (
          <span className="chip-col" key={value} style={colStyle(i)}>
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
