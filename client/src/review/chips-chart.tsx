import type { MatchSeatReview } from '../net/types.ts';

const W = 640;
const H = 200;
const PAD_X = 8;
const PAD_Y = 10;

/* Every seat's stack across the match, one line each. Bespoke SVG for the
   same reason rating-graph.tsx is bespoke: g ships g.chart, but it draws
   into a node it owns and re-renders by being called again, which fights
   React, and a handful of lines is not worth fighting it for.

   The x axis is hand number, not time: a stalled hand and a fast one take the
   same width, which is what makes six seats bust at visibly different points
   along it rather than clustering near a game's slow middle. Colours cycle
   through the six chart tokens, so the chart stays legible across all four
   palettes and both themes without a colour of its own. */
export function ChipsChart({ seats, meId }: { seats: MatchSeatReview[]; meId: string | null }) {
  const withPoints = seats.filter((s) => s.chips.length > 0);
  if (withPoints.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <span className="e-title">No hands to chart</span>
        </div>
      </div>
    );
  }

  const lastHand = Math.max(...withPoints.map((s) => s.chips[s.chips.length - 1].hand));
  const maxChips = Math.max(...withPoints.flatMap((s) => s.chips.map((p) => p.chips)), 1);
  const x = (hand: number) => PAD_X + (lastHand <= 1 ? 0 : ((hand - 1) / (lastHand - 1)) * (W - PAD_X * 2));
  const y = (chips: number) => PAD_Y + (1 - chips / maxChips) * (H - PAD_Y * 2);

  return (
    <div className="chips-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Chip stack by hand, one line per seat">
        <line x1={PAD_X} y1={y(0)} x2={W - PAD_X} y2={y(0)} className="chips-zero" />
        {withPoints.map((s, i) => {
          const d = s.chips
            .map((p, pi) => `${pi === 0 ? 'M' : 'L'}${x(p.hand).toFixed(2)},${y(p.chips).toFixed(2)}`)
            .join(' ');
          const mine = s.userId === meId;
          return (
            <path
              key={s.userId}
              d={d}
              className="chips-line"
              data-mine={mine ? '' : undefined}
              style={{ stroke: `var(--chart-${(i % 6) + 1})` }}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <div className="chips-legend">
        {withPoints.map((s, i) => (
          <span className="item" key={s.userId} data-mine={s.userId === meId ? '' : undefined}>
            <span className="dot" style={{ background: `var(--chart-${(i % 6) + 1})` }} />
            {s.name}
            <span className="num">{s.finalStack ?? s.chips[s.chips.length - 1].chips}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
