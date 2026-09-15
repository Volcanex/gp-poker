import { Link } from 'react-router-dom';
import { Avatar } from '../ui/avatar.tsx';
import { fmtPct } from '../ui/format.ts';
import { ordinal } from '../table/labels.ts';
import { avatarVersion } from '../net/adapt.ts';
import { Spider } from './spider.tsx';
import { AccuracyTile } from './accuracy.tsx';
import { ChipSpark } from './chip-spark.tsx';
import { reads } from './reads.ts';
import type { MatchSeatReview } from '../net/types.ts';

const STREET_ORDER: { key: keyof NonNullable<MatchSeatReview['insights']['streets']>; label: string }[] = [
  { key: 'preflop', label: 'Preflop' },
  { key: 'flop', label: 'Flop' },
  { key: 'turn', label: 'Turn' },
  { key: 'river', label: 'River' },
  { key: 'showdown', label: 'Showdown' },
];

/* One seat's whole review: the spider, backed by the raw counts below it;
   accuracy with its own caveat; a couple of sentences a player could act on;
   and, only once there is enough of a career sample, the same VPIP/PFR tiles
   the profile prints. `studied` says whether this mode stores preflop study
   at all (heads-up only), which is a fact about the match, not the seat, but
   travels on every card so each one can say why the tile is empty rather
   than leaving it blank. */
export function PlayerCard({
  seat,
  you,
  studied,
  maxChips,
}: {
  seat: MatchSeatReview;
  you: boolean;
  studied: boolean;
  maxChips: number;
}) {
  const bullets = reads(seat.raw);
  const streets = seat.insights.streets;

  return (
    <div className="card review-player" data-result={seat.result} data-you={you ? '' : undefined}>
      <div className="rvp-head">
        <Avatar seed={seat.userId} name={seat.name} size={32} avatarV={avatarVersion(seat.avatarV)} />
        <div className="rvp-who">
          <Link className="rvp-name" to={`/u/${encodeURIComponent(seat.name)}`}>{seat.name}</Link>
          <span className="rvp-sub">
            {seat.bot && <span className="seat-bot">Bot</span>}
            {you && <span className="seat-you">You</span>}
            {seat.place !== null && <span className="muted">{ordinal(seat.place)}</span>}
          </span>
        </div>
        {seat.result === 'win' && <span className="badge badge-ok">Won</span>}
        {seat.result === 'draw' && <span className="badge">Draw</span>}
      </div>

      <div className="rvp-chips">
        <span className="muted">Chips by hand</span>
        <ChipSpark seat={seat} maxChips={maxChips} you={you} />
      </div>

      <Spider raw={seat.raw} label={seat.name} />

      {bullets.length > 0 && (
        <ul className="rvp-reads">
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <div className="tiles tiles-one">
        <AccuracyTile accuracy={seat.accuracy} studied={studied} />
      </div>

      {streets && (
        <div className="rvp-streets">
          <span className="muted">Where this seat's hands ended</span>
          <div
            className="rvp-street-track"
            role="img"
            aria-label={STREET_ORDER.map((s) => `${s.label} ${fmtPct(streets[s.key], 0)}`).join(', ')}
          >
            {STREET_ORDER.map((s) =>
              streets[s.key] > 0 ? (
                <span key={s.key} className="seg" data-street={s.key} style={{ width: `${streets[s.key]}%` }} />
              ) : null
            )}
          </div>
        </div>
      )}

      {seat.insights.preflop && (
        <div className="rvp-career">
          <span className="muted">
            Over {seat.insights.sample.hands} hands in {seat.insights.sample.matches}{' '}
            {seat.insights.sample.matches === 1 ? 'match' : 'matches'} at this mode
          </span>
        </div>
      )}
    </div>
  );
}
