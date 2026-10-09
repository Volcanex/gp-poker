import { AXES, axisPoints, styleWords, type AxisPoint } from './style.ts';
import type { MatchRawRates } from '../net/types.ts';

const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 95;
// The axis labels sit outside the R ring (see LABEL_R below); the extra
// margin the square viewBox carries beyond 2*R is what keeps "WTSD" and
// "C-bet" from clipping against the edge, which a tighter box did.
const LABEL_R = 1.3;
const RINGS = [0.33, 0.66, 1];
// An axis with nothing to divide by is drawn near the centre rather than at
// it, so six missing axes do not collapse onto one indistinguishable point;
// the hollow marker and the dashed spokes either side are what say "unread",
// not "low".
const NO_DATA_R = 0.08;

function angle(i: number): number {
  return -Math.PI / 2 + i * ((Math.PI * 2) / AXIS_COUNT);
}

const AXIS_COUNT = 6;

function pointAt(i: number, v: number): [number, number] {
  const a = angle(i);
  return [CX + R * v * Math.cos(a), CY + R * v * Math.sin(a)];
}

/* One player's tight-loose / passive-aggressive shape, over VPIP, PFR,
   three-bet, aggression factor, c-bet and went-to-showdown. Bespoke SVG for
   the same reason rating-graph.tsx is: g ships no radar chart, and this is a
   handful of trig calls rather than something worth a new g-system
   component's worth of API surface for one page. See client/src/review/CLAUDE.md
   for why a normalised shape is drawn at all given the honesty rule.

   A point alone is not enough: a ring position from 1 of 1 hands and one
   from 44 of 50 look identical if the only thing drawn is where the rate
   landed, which is the exact inversion the feature exists to avoid: the
   least evidence drawing the most confident-looking shape. So the chart
   draws each axis's 95% Wilson interval (style.ts) as a band between an
   inner and an outer polygon, filled only in the space between them, with
   the point itself as a thin line inside that band. At of:1 the band
   swallows most of the ring; at of:44 it draws tight around the point. The
   uncertainty is geometry, not a caption, so it survives a screenshot with
   the legend cropped out. Aggression factor has no band (style.ts: Wilson
   is for a proportion, and a ratio of calls to raises is not one), so that
   axis is a point alone and says so in the legend below. */
export function Spider({ raw, label }: { raw: MatchRawRates; label: string }) {
  const points = axisPoints(raw);
  const style = styleWords(raw);

  const vertices = points.map((p, i) => pointAt(i, p.value ?? NO_DATA_R));
  const innerVertices = points.map((p, i) => pointAt(i, p.lower ?? p.value ?? NO_DATA_R));
  const outerVertices = points.map((p, i) => pointAt(i, p.upper ?? p.value ?? NO_DATA_R));
  const ciPath =
    `M${outerVertices.map((v) => v.join(',')).join('L')}Z ` +
    `M${innerVertices.map((v) => v.join(',')).join('L')}Z`;

  return (
    <div className="spider">
      <div className="spider-head">
        <span className="spider-style">{style ?? 'Not enough hands to read a style'}</span>
      </div>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel(label, points)}>
        {RINGS.map((r) => (
          <polygon
            key={r}
            points={Array.from({ length: AXIS_COUNT }, (_, i) => pointAt(i, r).join(',')).join(' ')}
            className="spider-ring"
          />
        ))}
        {points.map((_, i) => {
          const [x, y] = pointAt(i, 1);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} className="spider-spoke" />;
        })}
        <path d={ciPath} className="spider-ci" fillRule="evenodd" />
        {points.map((p, i) => {
          const a = vertices[i];
          const b = vertices[(i + 1) % AXIS_COUNT];
          const dashed = p.value === null || points[(i + 1) % AXIS_COUNT].value === null;
          return (
            <line
              key={i}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              className="spider-edge"
              data-dashed={dashed ? '' : undefined}
            />
          );
        })}
        {points.map((p, i) => {
          const [x, y] = vertices[i];
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={p.value === null ? 3.5 : 3}
              className="spider-vertex"
              data-empty={p.value === null ? '' : undefined}
            />
          );
        })}
        {points.map((p, i) => {
          const [x, y] = pointAt(i, LABEL_R);
          return (
            <text key={i} x={x} y={y} className="spider-label" textAnchor={anchorFor(i)} dominantBaseline="middle">
              {p.axis.short}
            </text>
          );
        })}
      </svg>
      <dl className="spider-legend">
        {points.map((p) => (
          <div className="row" key={p.axis.key} data-empty={p.value === null ? '' : undefined}>
            <dt>
              {p.axis.label}
              {p.axis.unit === 'x' && <span className="spider-flag">no interval, a ratio not a share</span>}
            </dt>
            <dd className="num">{p.display}</dd>
          </div>
        ))}
      </dl>
      <p className="spider-note">
        Ring position is each rate against a typical range for its axis (see
        the guide below); the shaded band around it is how much a sample this
        size could be off by, tighter with more hands and wide enough at one
        or two to swallow the axis; the count beside it is what actually
        happened.
      </p>
      <details className="spider-band">
        <summary>What "typical" means on this chart</summary>
        <dl>
          {AXES.map((a) => (
            <div className="row" key={a.key}>
              <dt>{a.short}</dt>
              <dd>
                {a.unit === 'x'
                  ? `${a.typical[0]}x–${a.typical[1]}x typical, ${a.max}x fills the ring`
                  : `${a.typical[0]}–${a.typical[1]}% typical, ${a.max}% fills the ring`}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

// Six fixed positions (top, going clockwise): the label anchors away from
// the chart on the two side pairs and stays centred at the top and bottom.
const LABEL_ANCHOR: ('start' | 'middle' | 'end')[] = ['middle', 'start', 'start', 'middle', 'end', 'end'];

function anchorFor(i: number): 'start' | 'middle' | 'end' {
  return LABEL_ANCHOR[i] ?? 'middle';
}

function ariaLabel(name: string, points: AxisPoint[]): string {
  return `${name}'s play this match: ${points.map((p) => `${p.axis.short} ${p.display}`).join(', ')}`;
}
