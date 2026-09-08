/* Pot odds trainer. A spot, a price, and one question: is your equity bigger
   than the fraction of the pot you are being asked to put in?

   The equity is against random hands, which is the honest thing to train
   against here: the point is the arithmetic of the price, not a read. Every
   number is computed in the analysis worker while you think, so the answer is
   already there when you press a key. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FULL_DECK } from '@opentable/equity/cards';
import type { EquityResult, OutsResult } from '@opentable/equity';
import { analyse, analyseOuts, cancel, isCancelled, nextRequestId } from '../analysis/index.ts';
import { isTextEntry } from '../ui/bits.tsx';
import { BoardText } from '../ui/board-text.tsx';
import { useTitle } from '../ui/title.ts';

const STORE = 'ot.odds';
const BET_FRACTIONS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];

export interface Spot {
  hero: [string, string];
  board: string[];
  pot: number; // what is out there before you call, their bet included
  bet: number; // what it costs you
  opponents: number;
}

export interface Score {
  right: number;
  total: number;
  streak: number;
  best: number;
}

const EMPTY: Score = { right: 0, total: 0, streak: 0, best: 0 };

/* The share of the final pot your call has to win to break even. */
export function requiredEquity(spot: Spot): number {
  return spot.bet / (spot.pot + spot.bet);
}

export function callIsRight(equity: number, spot: Spot): boolean {
  return equity >= requiredEquity(spot);
}

export function accuracy(score: Score): number {
  return score.total === 0 ? 0 : (score.right / score.total) * 100;
}

export function readScore(): Score {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Score>;
    return {
      right: Number(parsed.right) || 0,
      total: Number(parsed.total) || 0,
      streak: Number(parsed.streak) || 0,
      best: Number(parsed.best) || 0,
    };
  } catch {
    return EMPTY;
  }
}

export function writeScore(score: Score): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(score));
  } catch {
    // A browser with storage turned off still gets to practise.
  }
}

export function scoreAfter(score: Score, right: boolean): Score {
  const streak = right ? score.streak + 1 : 0;
  return {
    right: score.right + (right ? 1 : 0),
    total: score.total + 1,
    streak,
    best: Math.max(score.best, streak),
  };
}

export function dealSpot(random: () => number = Math.random): Spot {
  const deck = [...FULL_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const boardSize = random() < 0.5 ? 3 : 4;
  const pot = 10 + Math.round(random() * 25) * 2;
  const bet = Math.max(1, Math.round(pot * BET_FRACTIONS[Math.floor(random() * BET_FRACTIONS.length)]));
  return {
    hero: [deck[0], deck[1]],
    board: deck.slice(2, 2 + boardSize),
    pot,
    bet,
    opponents: random() < 0.7 ? 1 : 2,
  };
}

export function Odds() {
  const [spot, setSpot] = useState<Spot>(() => dealSpot());
  const [equity, setEquity] = useState<EquityResult | null>(null);
  const [outs, setOuts] = useState<OutsResult | null>(null);
  const [answer, setAnswer] = useState<'call' | 'fold' | null>(null);
  const [score, setScore] = useState<Score>(EMPTY);
  const answered = useRef(false);
  useTitle('Pot odds trainer');

  useEffect(() => setScore(readScore()), []);

  useEffect(() => {
    const ids = [nextRequestId('e'), nextRequestId('o')];
    let live = true;
    setEquity(null);
    setOuts(null);
    Promise.all([
      analyse({
        id: ids[0],
        hero: spot.hero,
        board: spot.board,
        villains: Array.from({ length: spot.opponents }, () => 'random' as const),
      }).then((r) => live && setEquity(r)),
      analyseOuts({ id: ids[1], hero: spot.hero, board: spot.board }).then((r) => live && setOuts(r)),
    ]).catch((err) => {
      if (!live || isCancelled(err)) return;
      console.error(err);
    });
    return () => {
      live = false;
      for (const id of ids) cancel(id);
    };
  }, [spot]);

  const next = useCallback(() => {
    answered.current = false;
    setAnswer(null);
    setSpot(dealSpot());
  }, []);

  const answerWith = useCallback(
    (choice: 'call' | 'fold') => {
      if (answered.current || !equity) return;
      answered.current = true;
      setAnswer(choice);
      const right = callIsRight(equity.equity, spot) === (choice === 'call');
      setScore((prev) => {
        const updated = scoreAfter(prev, right);
        writeScore(updated);
        return updated;
      });
    },
    [equity, spot],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
      const key = event.key.toLowerCase();
      if (!answer && (key === 'c' || key === 'f')) {
        event.preventDefault();
        answerWith(key === 'c' ? 'call' : 'fold');
      } else if (answer && (key === 'n' || key === 'enter')) {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, answerWith, next]);

  const required = requiredEquity(spot);
  const right = equity ? callIsRight(equity.equity, spot) === (answer === 'call') : false;
  const bestAction = equity ? (callIsRight(equity.equity, spot) ? 'Calling' : 'Folding') : '';
  const heroWord = useMemo(() => (spot.opponents === 1 ? 'one opponent' : 'two opponents'), [spot.opponents]);

  return (
    <main className="page stack tools-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Pot odds trainer</h1>
        <p className="muted">
          One question, over and over: does your hand win often enough to pay the price in front of
          you? Equity here is against random hands, so it is a floor rather than a read. Ranges live
          in the <Link to="/tools/ranges">range explorer</Link>.
        </p>
      </div>

      <section className="card stack" aria-label="The spot">
        <div className="spot-cards">
          <div className="field">
            <span className="label">Your hand</span>
            <BoardText cards={spot.hero} />
          </div>
          <div className="field">
            <span className="label">Board</span>
            <BoardText cards={spot.board} />
          </div>
        </div>

        <p className="spot-line">
          Against {heroWord}, the pot is <span className="num">{spot.pot}</span> and it costs{' '}
          <span className="num">{spot.bet}</span> to call.
        </p>

        {!answer ? (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => answerWith('call')} disabled={!equity}>
              Call
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => answerWith('fold')} disabled={!equity}>
              Fold
            </button>
            <span className="muted small">{equity ? 'Or press C or F.' : 'Working out the spot.'}</span>
          </div>
        ) : (
          <div className="stack">
            <span className={`badge verdict ${right ? 'badge-ok' : 'badge-warn'}`}>
              {right ? 'Right' : 'Not this one'}
            </span>
            <dl className="results">
              <div>
                <dt>Your equity</dt>
                <dd className="num">{equity ? `${(equity.equity * 100).toFixed(1)}%` : '—'}</dd>
                <dd className="muted small">
                  {equity?.exact ? 'exact' : `sampled, ${equity?.samples.toLocaleString('en-GB')} deals`}
                </dd>
              </div>
              <div>
                <dt>The price</dt>
                <dd className="num">{(required * 100).toFixed(1)}%</dd>
                <dd className="muted small">
                  {spot.bet} to win {spot.pot + spot.bet}
                </dd>
              </div>
              <div>
                <dt>Outs</dt>
                <dd className="num">{outs ? outs.count : '—'}</dd>
                <dd className="muted small">{outs?.draws.join(', ') || 'no named draw'}</dd>
              </div>
            </dl>
            <p className="muted">
              {bestAction} is right here: {bestAction === 'Calling' ? 'your equity clears the price' : 'the price is higher than your equity'}.
              {outs && outs.cards.length > 0 && (
                <>
                  {' '}
                  The cards that improve you: <BoardText cards={outs.cards.slice(0, 10)} />
                  {outs.cards.length > 10 && ` and ${outs.cards.length - 10} more`}.
                </>
              )}
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={next}>
                Deal the next spot
              </button>
              <span className="muted small">Or press N.</span>
            </div>
          </div>
        )}
      </section>

      <section className="card score-row" aria-label="Your record">
        <div>
          <span className="label">Streak</span>
          <span className="num">{score.streak}</span>
        </div>
        <div>
          <span className="label">Best streak</span>
          <span className="num">{score.best}</span>
        </div>
        <div>
          <span className="label">Accuracy</span>
          <span className="num">{score.total ? `${accuracy(score).toFixed(0)}%` : '—'}</span>
        </div>
        <div>
          <span className="label">Spots</span>
          <span className="num">{score.total}</span>
        </div>
      </section>
    </main>
  );
}
