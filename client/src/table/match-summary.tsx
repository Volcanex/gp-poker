import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { useReducedMotion } from 'motion/react';
import type { MatchResult, TableView } from '@opentable/protocol';
import type { Match } from '../net/types.ts';
import { BoardText } from '../ui/board-text.tsx';
import { fmtDate, fmtPct, int, signed } from '../ui/format.ts';
import { handAccuracy, matchHasAccuracy } from '../net/adapt.ts';

export interface MatchSummaryProps {
  match: Match;
  meId: string | null;
  onAgain: () => void;
  againLabel?: string;
}

/* The count is on the line beside this one, so the reason does not repeat it. */
function reasonText(r: Match['reason']): string {
  switch (r) {
    case 'bust': return 'A stack hit zero.';
    case 'hands': return 'The match went the full distance.';
    case 'forfeit': return 'Forfeited on the clock after three timeouts.';
    case 'draw': return 'Level stacks after the last hand.';
    case 'abort': return 'The match was abandoned before it could finish.';
    default: return '';
  }
}

export function MatchSummary({ match, meId, onAgain, againLabel }: MatchSummaryProps) {
  const mine = meId ? match.seats.find((s) => s.userId === meId) : undefined;
  const showAccuracy = matchHasAccuracy(match);
  const winnerSeat = match.winner ? match.seats.find((s) => s.userId === match.winner) : null;

  const verdict = match.winner == null
    ? 'Draw'
    : mine
      ? match.winner === mine.userId ? 'You win' : 'You lose'
      : `${winnerSeat?.name ?? 'Unknown'} wins`;

  return (
    <main className="page stack">
      <header>
        <h1 className="h1">{verdict}</h1>
        <span className="muted">
          {reasonText(match.reason)} {match.rated ? 'Rated' : 'Unrated'} match over{' '}
          {match.handsPlayed} {match.handsPlayed === 1 ? 'hand' : 'hands'}
          {match.finishedAt ? `, finished ${fmtDate(match.finishedAt)}` : ''}.
        </span>
      </header>

      <div className="two">
        {match.seats.map((seat) => (
          <PlayerResult
            key={seat.userId}
            name={seat.name}
            stack={match.finalStacks?.[seat.userId] ?? 0}
            rating={match.ratings?.[seat.userId] ?? null}
            won={match.winner === seat.userId}
            you={mine?.userId === seat.userId}
          />
        ))}
      </div>

      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          {againLabel ?? 'Play again'}
        </button>
        <Link className="btn btn-tertiary" to="/">Back to home</Link>
      </div>

      <section className="stack" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Hands</span>
        {match.hands.length === 0 ? (
          <div className="card">
            <div className="empty">
              {match.handsPlayed > 0 ? (
                <>
                  <span className="e-title">Hand histories are not loaded</span>
                  <span className="e-desc">
                    The match record did not come back with this page. Reload to fetch it.
                  </span>
                </>
              ) : (
                <>
                  <span className="e-title">No hands recorded</span>
                  <span className="e-desc">The match ended before a hand completed.</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="card lb-card">
            <div className="table-wrap">
              <table className="table" aria-label="Hands in this match">
                <thead>
                  <tr>
                    <th className="r" style={{ width: 40 }}>#</th>
                    <th>Board</th>
                    <th>Won by</th>
                    <th className="r">Pot</th>
                    {showAccuracy && match.seats.map((s) => (
                      <th className="r" key={s.userId}>{s.name}</th>
                    ))}
                    <th className="r">Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {match.hands.map((h) => {
                    const award = h.awards?.[0] ?? null;
                    const winner = award ? match.seats.find((s) => s.seat === award.seat) : null;
                    return (
                      <tr key={h.number}>
                        <td className="r">{h.number}</td>
                        <td><BoardText cards={h.board} /></td>
                        <td>{winner ? winner.name : h.completedAt ? 'Split' : 'In progress'}</td>
                        <td className="r">{award ? award.amount : ''}</td>
                        {showAccuracy && match.seats.map((s) => {
                          const acc = handAccuracy(h, s.seat);
                          return (
                            <td className="r" key={s.userId}>
                              {acc == null ? <span className="muted">no read</span> : fmtPct(acc, 0)}
                            </td>
                          );
                        })}
                        <td className="r">
                          <Link to={`/m/${match.id}/h/${h.number}`}>Open</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {showAccuracy && (
          <span className="muted">
            The two name columns are each player's preflop accuracy against the baseline charts,
            which are a rough guide and not solver output.
          </span>
        )}
      </section>
    </main>
  );
}

function PlayerResult({
  name,
  stack,
  rating,
  won,
  you,
}: {
  name: string;
  stack: number;
  rating: { before: number; after: number; rdBefore: number; rdAfter: number } | null;
  won: boolean;
  you: boolean;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (rating ? int(rating.before) : 0));

  /* The rating moves once, after a beat, so it reads as a change rather than a
     value that happened to land there. */
  useEffect(() => {
    if (!rating) return;
    if (reduced) {
      setShown(int(rating.after));
      return;
    }
    setShown(int(rating.before));
    const timer = setTimeout(() => setShown(int(rating.after)), 420);
    return () => clearTimeout(timer);
  }, [rating, reduced]);

  const delta = rating ? rating.after - rating.before : 0;
  const tone = delta > 0 ? { 'data-up': '' } : delta < 0 ? { 'data-down': '' } : { 'data-flat': '' };

  return (
    <div className="card player-result" data-won={won ? '' : undefined}>
      <div className="pr-head">
        <Link className="pr-name" to={`/u/${encodeURIComponent(name)}`}>{name}</Link>
        {you && <span className="seat-you">you</span>}
        {won && <span className="badge badge-ok">Won</span>}
      </div>
      <div className="pr-stack num">
        {int(stack)}
        <span className="u">units left</span>
      </div>
      {rating ? (
        <div className="pr-rating">
          <span className="v num">
            <NumberFlow value={shown} format={{ useGrouping: false }} respectMotionPreference />
          </span>
          <span className="delta" {...tone}>{signed(delta)}</span>
          <span className="muted">deviation {int(rating.rdAfter)}</span>
        </div>
      ) : (
        <span className="muted">Unrated. Nothing changed on the ladder.</span>
      )}
    </div>
  );
}

/* The websocket's end message plus the last table view carries everything the
   summary needs except the hand list. Used when the match endpoint cannot be
   reached, and by the mock table, so there is one result component rather than
   one per source. */
export function matchFromEnd(view: TableView, result: MatchResult): Match {
  return {
    id: view.m,
    format: view.format,
    rated: result.rated,
    seats: view.seats.map((s) => ({ seat: s.i, userId: s.uid, name: s.name })),
    status: 'finished',
    winner: result.winner,
    reason: result.reason,
    handsPlayed: view.handsPlayed || view.h,
    finalStacks: result.stacks,
    ratings: result.ratings,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    hands: [],
  };
}
