import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { useReducedMotion } from 'motion/react';
import type { MatchResult, TableView } from '@opentable/protocol';

export interface ResultScreenProps {
  result: MatchResult;
  meId: string;
  view: TableView;
  onAgain: () => void;
  againLabel?: string;
}

function reasonText(r: MatchResult['reason'], hands: number): string {
  switch (r) {
    case 'bust': return 'A stack hit zero.';
    case 'hands': return `All ${hands} hands played.`;
    case 'forfeit': return 'Forfeited on the clock after three timeouts.';
    case 'draw': return 'Level stacks after the last hand.';
    case 'abort': return 'The match was abandoned before it could finish.';
  }
}

export function ResultScreen({ result, meId, view, onAgain, againLabel }: ResultScreenProps) {
  const reduced = useReducedMotion();
  const mine = result.ratings[meId];
  const [shownRating, setShownRating] = useState(() => (mine ? mine.before : 0));

  /* The rating moves once, after a beat, so the number is read as a change
     rather than as a value that happened to land there. */
  useEffect(() => {
    if (!mine) return;
    if (reduced) {
      setShownRating(mine.after);
      return;
    }
    setShownRating(mine.before);
    const timer = setTimeout(() => setShownRating(mine.after), 420);
    return () => clearTimeout(timer);
  }, [mine, reduced]);

  const won = result.winner === meId;
  const drew = result.winner == null;
  const verdict = drew ? 'Draw' : won ? 'You win' : 'You lose';
  const delta = mine ? mine.after - mine.before : 0;
  const tone = delta > 0 ? 'data-up' : delta < 0 ? 'data-down' : 'data-flat';

  return (
    <div className="result-scrim" role="dialog" aria-modal="true" aria-label="Match result">
      <div className="result">
        <div>
          <div className="verdict">{verdict}</div>
          <div className="why">{reasonText(result.reason, view.format.hands)}</div>
        </div>

        <div className="grid">
          {view.seats.map((s) => (
            <div className="card stat" key={s.i}>
              <span className="k">{s.uid === meId ? 'Your stack' : `${s.name}'s stack`}</span>
              <span className="v">{result.stacks[s.uid] ?? s.stack}</span>
            </div>
          ))}
        </div>

        {mine ? (
          <div className="card stat">
            <span className="k">Your rating</span>
            <span className="v">
              <NumberFlow value={shownRating} format={{ useGrouping: false }} respectMotionPreference />
            </span>
            <span className="delta" {...{ [tone]: '' }}>
              {delta > 0 ? '+' : ''}{delta} · deviation {Math.round(mine.rdAfter)}
            </span>
          </div>
        ) : (
          <div className="card">
            <span className="muted">
              {result.rated ? 'Rating update pending.' : 'Unrated match. Nothing changed on the ladder.'}
            </span>
          </div>
        )}

        <div className="acts">
          <button type="button" className="btn btn-primary" onClick={onAgain}>
            {againLabel ?? 'Play again'}
          </button>
          <Link className="btn btn-tertiary" to="/">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
