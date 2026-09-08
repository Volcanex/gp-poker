/* The 13 by 13 grid of starting hands, shared by the range explorer and the
   opening explorer. Pairs run down the diagonal, suited above it, offsuit
   below, which is the layout every poker chart in the world uses.

   The grid owns the layout, the roving tab index, the paint gesture and the
   entrance; what a cell looks like is the caller's, through `cell`. That split
   is what lets one page paint a range on it and another shade it by a
   frequency without either of them reimplementing arrow key navigation across
   169 buttons. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAnimate, useReducedMotion } from 'motion/react';
import { classKind, HAND_GRID, RANKS } from '@opentable/equity/range';
import { CELL_ENTER, centreDelay, ENTER_SCALE } from './ramp.ts';

export interface HandCell {
  /* What the cell reads, usually the class or a number. */
  content: React.ReactNode;
  /* What a screen reader hears. The class alone on a range grid, the class
     and its numbers on a shaded one. */
  label: string;
  selected?: boolean;
  style?: React.CSSProperties;
  /* Rendered as data-tone, for a cell whose shade means something. */
  tone?: string;
}

export interface HandGridProps {
  label: string;
  cell: (cls: string) => HandCell;
  /* Paint: called on press and again for every cell dragged over, with the
     value the press decided. Leaving it out makes the grid read-only. */
  onPaint?: (cls: string, adding: boolean) => void;
  /* The cell under the pointer or the keyboard focus, null when there is
     none. A page with a detail panel reads this. */
  onShow?: (cls: string | null) => void;
  /* Rank strips down the left and across the top. A grid whose cells read
     their own class does not need them; one whose cells read a number does,
     or nobody can tell which hand they are looking at. Decorative only: every
     cell already names its hand to a screen reader. */
  ranks?: boolean;
  hint?: React.ReactNode;
  /* Bump this whenever the whole grid means something new: another preset,
     another seat, another shade. The 169 cells then arrive again in a wave out
     from the middle. Painting one cell must NOT touch it, or a dragged range
     restarts the entrance under the pointer. Leaving it out means no
     entrance at all. */
  wave?: string | number;
}

/* A run of wave changes settles into one entrance rather than 60 of them: a
   dragged slider fires a change per step, and each would otherwise blank the
   grid and start over. Only after the drag stops does the wave run. */
const SETTLE = 120;

export function HandGrid({ label, cell, onPaint, onShow, ranks, hint, wave }: HandGridProps) {
  const painting = useRef<boolean | null>(null);
  const [gridRef, animate] = useAnimate<HTMLDivElement>();
  const reduced = useReducedMotion();
  const mounted = useRef(false);
  const [focus, setFocus] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    const stop = () => {
      painting.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  /* The cells are plain buttons driven imperatively rather than 169
     motion.button elements, so the roving tab index, the paint gesture and the
     shade stay exactly as React renders them and only opacity and transform
     are ever touched. Laid out before paint, so the first frame is the hidden
     one rather than a whole grid flashing in and back out. */
  useLayoutEffect(() => {
    if (reduced) {
      /* The setting can be turned on while a wave is in flight, and a cell the
         animation never finished would be left at nothing. */
      for (const node of gridRef.current?.querySelectorAll<HTMLElement>('.cell') ?? []) {
        node.style.removeProperty('opacity');
        node.style.removeProperty('transform');
      }
      return undefined;
    }
    if (wave === undefined) return undefined;
    const run = () => {
      const cells = gridRef.current?.querySelectorAll<HTMLElement>('.cell');
      if (!cells) return;
      for (const node of cells) {
        node.style.opacity = '0';
        node.style.transform = `scale(${ENTER_SCALE})`;
      }
      for (const node of cells) {
        animate(
          node,
          { opacity: [0, 1], scale: [ENTER_SCALE, 1] },
          { duration: CELL_ENTER, ease: [0.2, 0, 0, 1], delay: centreDelay(Number(node.dataset.r), Number(node.dataset.c)) },
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
  }, [wave, reduced, animate, gridRef]);

  const move = (row: number, col: number) => {
    const r = Math.max(0, Math.min(12, row));
    const c = Math.max(0, Math.min(12, col));
    setFocus([r, c]);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const [r, c] = focus;
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(r - 1, c),
      ArrowDown: () => move(r + 1, c),
      ArrowLeft: () => move(r, c - 1),
      ArrowRight: () => move(r, c + 1),
      Home: () => move(r, 0),
      End: () => move(r, 12),
    };
    const handler = keys[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  return (
    <div className="grid-wrap">
      <div
        className="hand-grid"
        data-ranks={ranks ? '' : undefined}
        role="grid"
        aria-label={label}
        aria-multiselectable={onPaint ? true : undefined}
        ref={gridRef}
        onKeyDown={onKeyDown}
        onPointerLeave={() => onShow?.(null)}
      >
        {ranks ? (
          <div className="grid-row rank-row" aria-hidden="true">
            <span className="rank" />
            {RANKS.map((rank) => (
              <span className="rank" key={rank}>{rank}</span>
            ))}
          </div>
        ) : null}
        {HAND_GRID.map((row, r) => (
          <div className="grid-row" role="row" key={r}>
            {ranks ? <span className="rank" aria-hidden="true">{RANKS[r]}</span> : null}
            {row.map((cls, c) => {
              const view = cell(cls);
              const on = view.selected === true;
              return (
                <button
                  key={cls}
                  type="button"
                  role="gridcell"
                  data-r={r}
                  data-c={c}
                  data-kind={classKind(cls)}
                  data-tone={view.tone}
                  className="cell"
                  style={view.style}
                  aria-selected={onPaint ? on : undefined}
                  aria-label={view.label}
                  tabIndex={focus[0] === r && focus[1] === c ? 0 : -1}
                  onFocus={() => {
                    setFocus([r, c]);
                    onShow?.(cls);
                  }}
                  onBlur={() => onShow?.(null)}
                  onPointerDown={(e) => {
                    if (!onPaint) return;
                    e.preventDefault();
                    painting.current = !on;
                    onPaint(cls, !on);
                  }}
                  onPointerEnter={() => {
                    onShow?.(cls);
                    if (onPaint && painting.current !== null) onPaint(cls, painting.current);
                  }}
                  onClick={(e) => {
                    // A pointer already painted this cell; only the keyboard
                    // should toggle it a second time.
                    if (!onPaint || e.detail !== 0) return;
                    onPaint(cls, !on);
                  }}
                >
                  {view.content}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {hint ? <p className="muted grid-hint">{hint}</p> : null}
    </div>
  );
}
