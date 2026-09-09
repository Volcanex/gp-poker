import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { motion, useReducedMotion } from 'motion/react';
import type { Match } from '../net/types.ts';
import { Avatar } from '../ui/avatar.tsx';
import { avatarVersion } from '../net/adapt.ts';
import { deltaTone } from '../ui/bits.tsx';
import { int, signed } from '../ui/format.ts';
import { ordinal, stakeWord } from './labels.ts';
import { leaveText, leaverText } from './match-summary.tsx';
import { rankSeats } from './results.ts';

export interface ResultPanelProps {
  match: Match;
  meId: string | null;
  onAgain: () => void;
  onReview: () => void;
  againLabel?: string;
}

/* The match result, below the felt rather than instead of it. The table stays
   on screen and dimmed above this panel: losing a match used to replace the
   board the instant the last hand finished, so the hand that decided it was
   never seen. Lichess keeps the board; so do we. */
export function ResultPanel({ match, meId, onAgain, onReview, againLabel }: ResultPanelProps) {
  const reduced = useReducedMotion();
  const rows = rankSeats(match);
  const mine = meId ? rows.find((r) => r.seat.userId === meId) : undefined;
  const multiway = match.seats.length > 2;
  const winner = rows[0];
  /* The match's own flag, not the format's: a casual match is played on a
     format whose template says rated, and only the row knows it was not. */
  const stake = stakeWord({ rated: match.rated, practice: match.format.practice });

  const verdict =
    match.winner == null && !multiway
      ? 'The match is a draw'
      : mine
        ? mine.place === 1
          ? 'You win the match'
          : multiway
            ? `You finish ${ordinal(mine.place)}`
            : `${winner?.seat.name ?? 'Your opponent'} wins the match`
        : `${winner?.seat.name ?? 'Nobody'} wins the match`;

  return (
    <motion.section
      className="result-panel card"
      aria-label="Match result"
      initial={reduced ? false : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
    >
      <header className="rp-head">
        <Avatar
          seed={winner?.seat.userId ?? 'table'}
          name={winner?.seat.name ?? 'winner'}
          size={56}
          avatarV={avatarVersion(winner?.seat.avatarV)}
        />
        <div className="rp-verdict">
          <span className="rp-t">{verdict}</span>
          {/* The reason line, and the one reason worth its own words: a match
              somebody walked out of did not end the way a played-out one
              did, and the verdict alone would read as though it had. */}
          <span className="muted num">
            {match.reason === 'left' ? `${leaveText(leaverText(match, meId))} ` : ''}
            {match.handsPlayed} {match.handsPlayed === 1 ? 'hand' : 'hands'},{' '}
            {stake === 'rated' ? 'rated' : `${stake}, no rating change`}
          </span>
        </div>
      </header>

      <ol className="rp-rows">
        {rows.map((r) => (
          <li key={r.seat.userId} data-mine={r.seat.userId === meId ? '' : undefined}>
            <span className="rp-who">
              {multiway && <span className="rp-place num">{ordinal(r.place)}</span>}
              <Avatar
                seed={r.seat.userId}
                name={r.seat.name}
                size={24}
                avatarV={avatarVersion(r.seat.avatarV)}
              />
              <Link to={`/u/${encodeURIComponent(r.seat.name)}`}>{r.seat.name}</Link>
              {r.seat.userId === meId && <span className="seat-you">You</span>}
            </span>
            <span className="rp-nums num">
              <span className="rp-stack">{int(r.stack)} units</span>
              {match.rated && r.rating && <RatingMove rating={r.rating} />}
            </span>
          </li>
        ))}
      </ol>

      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          {againLabel ?? 'Play again'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onReview}>
          Review hands
        </button>
        <Link className="btn btn-tertiary" to="/">Back to home</Link>
      </div>
    </motion.section>
  );
}

/* Before to after, once, and the delta only once the count has landed: a
   number and its change arriving together is two things to read at once. */
function RatingMove({ rating }: { rating: { before: number; after: number } }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => int(rating.before));
  const [showDelta, setShowDelta] = useState(() => Boolean(reduced));

  useEffect(() => {
    if (reduced) {
      setShown(int(rating.after));
      setShowDelta(true);
      return;
    }
    setShown(int(rating.before));
    setShowDelta(false);
    const count = setTimeout(() => setShown(int(rating.after)), 420);
    const delta = setTimeout(() => setShowDelta(true), 1200);
    return () => { clearTimeout(count); clearTimeout(delta); };
  }, [rating, reduced]);

  const change = rating.after - rating.before;
  return (
    <span className="rp-rating">
      <NumberFlow value={shown} format={{ useGrouping: false }} respectMotionPreference />
      <span className="delta" {...deltaTone(change)} data-hidden={showDelta ? undefined : ''}>
        {signed(change)}
      </span>
    </span>
  );
}
