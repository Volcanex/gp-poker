import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { useReducedMotion } from 'motion/react';
import type { MatchResult, TableView } from '@opentable/protocol';
import type { Match } from '../net/types.ts';
import { BoardText } from '../ui/board-text.tsx';
import { fmtDate, fmtPct, int, signed } from '../ui/format.ts';
import { handAccuracy, matchHasAccuracy, seatIsBot, avatarVersion } from '../net/adapt.ts';
import { deltaTone } from '../ui/bits.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { ordinal, stakeName, stakeSentence } from './labels.ts';
import { rankSeats } from './results.ts';

export interface MatchSummaryProps {
  match: Match;
  meId: string | null;
  onAgain: () => void;
  againLabel?: string;
}



/* The match's own rated flag with the format's practice flag: a casual match
   is played on a format whose template says rated, so the two have to be read
   together. */
function stakeOf(match: Match): { rated: boolean; practice?: boolean } {
  return { rated: match.rated, practice: match.format.practice };
}

/* The count is on the line beside this one, so the reason does not repeat it. */
function reasonText(r: Match['reason'], players: number): string {
  switch (r) {
    case 'bust': return players > 2 ? 'Last player standing.' : 'A stack hit zero.';
    case 'hands': return 'The match went the full distance.';
    case 'forfeit': return 'Forfeited on the clock after three timeouts.';
    case 'draw': return 'Level stacks after the last hand.';
    case 'abort': return 'The match was abandoned before it could finish.';
    default: return '';
  }
}

/* The rating moves once, after a beat, so it reads as a change rather than a
   value that happened to land there. */
function useRatingReveal(rating: { before: number; after: number } | null): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (rating ? int(rating.before) : 0));

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

  return shown;
}

export function MatchSummary({ match, meId, onAgain, againLabel }: MatchSummaryProps) {
  const players = match.seats.length;
  const multiway = players > 2;
  const rows = rankSeats(match);
  const mine = meId ? rows.find((r) => r.seat.userId === meId) : undefined;
  const winnerSeat = match.winner ? match.seats.find((s) => s.userId === match.winner) : null;

  const verdict = match.winner == null && !multiway
    ? 'Draw'
    : mine
      ? mine.place === 1 ? 'You win' : multiway ? `You finished ${ordinal(mine.place)}` : 'You lose'
      : `${winnerSeat?.name ?? rows[0]?.seat.name ?? 'Nobody'} wins`;

  return (
    <main className="page stack">
      <header>
        <h1 className="h1">{verdict}</h1>
        <span className="muted">
          {reasonText(match.reason, players)} {stakeName(stakeOf(match))} match over{' '}
          {match.handsPlayed} {match.handsPlayed === 1 ? 'hand' : 'hands'}
          {match.finishedAt ? `, finished ${fmtDate(match.finishedAt)}` : ''}.
        </span>
        {/* A casual match still comes back with a ratings map, unchanged on
            both sides. Nothing about it reaches the screen: no rating, no
            delta, no deviation, just the line that says why. */}
        {stakeSentence(stakeOf(match)) && <div className="muted">{stakeSentence(stakeOf(match))}</div>}
      </header>

      {multiway ? (
        <section className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="card lb-card">
            <div className="table-wrap">
              <table className="table" aria-label="Finishing order">
                <thead>
                  <tr>
                    <th className="r" style={{ width: 44 }}>#</th>
                    <th>Player</th>
                    <th className="r">Units</th>
                    {match.rated && <th className="r">Rating</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.seat.userId} data-mine={r.seat.userId === meId ? '' : undefined}>
                      <td className="r num">{ordinal(r.place)}</td>
                      <td>
                        <span className="who">
                          <Avatar
                            seed={r.seat.userId}
                            name={r.seat.name}
                            size={24}
                            avatarV={avatarVersion(r.seat.avatarV)}
                          />
                          <Link to={`/u/${encodeURIComponent(r.seat.name)}`}>{r.seat.name}</Link>
                          {seatIsBot(r.seat) && <span className="seat-bot">bot</span>}
                          {r.seat.userId === meId && <span className="seat-you">you</span>}
                        </span>
                      </td>
                      <td className="r num">{int(r.stack)}</td>
                      {match.rated && (
                        <td className="r"><RatingCell rating={r.rating} /></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : (
        <div className="two">
          {rows.map((r) => (
            <PlayerResult
              key={r.seat.userId}
              userId={r.seat.userId}
              name={r.seat.name}
              avatarV={avatarVersion(r.seat.avatarV)}
              stack={r.stack}
              rating={match.rated ? r.rating : null}
              won={match.winner === r.seat.userId}
              you={mine?.seat.userId === r.seat.userId}
            />
          ))}
        </div>
      )}

      <div className="row-actions">
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          {againLabel ?? 'Play again'}
        </button>
        <Link className="btn btn-tertiary" to="/">Back to home</Link>
      </div>

      <HandsSection match={match} />
    </main>
  );
}

function RatingCell({ rating }: { rating: ResultRating }) {
  const shown = useRatingReveal(rating);
  if (!rating) return <span className="muted">no change</span>;
  const delta = rating.after - rating.before;
  return (
    <span className="rating-cell">
      <span className="v num">
        <NumberFlow value={shown} format={{ useGrouping: false }} respectMotionPreference />
      </span>
      <span className="delta" {...deltaTone(delta)}>{signed(delta)}</span>
    </span>
  );
}

type ResultRating = { before: number; after: number; rdBefore: number; rdAfter: number } | null;

function PlayerResult({
  userId,
  name,
  avatarV,
  stack,
  rating,
  won,
  you,
}: {
  userId: string;
  name: string;
  avatarV: number;
  stack: number;
  rating: ResultRating;
  won: boolean;
  you: boolean;
}) {
  const shown = useRatingReveal(rating);
  const delta = rating ? rating.after - rating.before : 0;

  return (
    <div className="card player-result" data-won={won ? '' : undefined}>
      <div className="pr-head">
        <Avatar seed={userId} name={name} size={24} avatarV={avatarV} />
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
          <span className="delta" {...deltaTone(delta)}>{signed(delta)}</span>
          <span className="muted">deviation {int(rating.rdAfter)}</span>
        </div>
      ) : null}
    </div>
  );
}

/* The hand list, its own component because the result panel under a finished
   table shows it too: "review hands" has to scroll to something. */
export function HandsSection({ match }: { match: Match }) {
  /* Preflop accuracy is scored against heads-up baseline charts, so the
     columns stay off a multiway table rather than printing a number the
     charts do not mean. */
  const showAccuracy = matchHasAccuracy(match) && match.seats.length <= 2;
  return (
    <section className="stack" id="hands" style={{ gap: 'var(--sp-3)' }}>
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
    seats: view.seats.map((s) => ({ seat: s.i, userId: s.uid, name: s.name, bot: s.bot })),
    status: 'finished',
    winner: result.winner,
    reason: result.reason,
    handsPlayed: view.handsPlayed || view.h,
    finalStacks: result.stacks,
    places: result.places,
    ratings: result.ratings,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    hands: [],
  };
}
