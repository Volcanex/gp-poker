import type { RatingPoint } from '../net/types.ts';
import { fmtShortDate } from './format.ts';

const W = 600;
const H = 140;
const PAD = 4;

export interface RatingGraphProps {
  points: RatingPoint[];
}

/* Bespoke, deliberately: g ships g.chart, but it draws into a DOM node it owns
   and re-renders by being called again, which fights React. This is one line
   and two labels, so it is drawn as JSX and reads --chart-1 from the theme.
   The labels sit in HTML beside the SVG rather than inside it, so they stay at
   their real size when the graph scales down on a phone. The line stretches to
   the box (preserveAspectRatio none) and holds its width with
   vector-effect, which is why there is no marker shape: a circle would
   stretch into an ellipse. */
export function RatingGraph({ points }: RatingGraphProps) {
  if (points.length < 2) {
    return (
      <div className="card">
        <div className="empty">
          <span className="e-title">No graph yet</span>
          <span className="e-desc">Play a rated match to start your graph.</span>
        </div>
      </div>
    );
  }

  const ratings = points.map((p) => p.rating);
  const lo = Math.min(...ratings);
  const hi = Math.max(...ratings);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (r: number) => PAD + (1 - (r - lo) / span) * (H - PAD * 2);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.rating).toFixed(2)}`).join(' ');
  const last = points[points.length - 1];

  return (
    <div className="card graph-card">
      <div className="graph">
        <div className="graph-y num">
          <span>{Math.round(hi)}</span>
          <span>{Math.round(lo)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Rating over ${points.length} rated matches, from ${Math.round(points[0].rating)} to ${Math.round(last.rating)}`}
        >
          <path className="graph-line" d={d} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="graph-x num">
        <span>{fmtShortDate(points[0].at)}</span>
        <span>{points.length} rated matches</span>
        <span>{fmtShortDate(last.at)}</span>
      </div>
    </div>
  );
}
