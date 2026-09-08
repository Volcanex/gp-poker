/* From a real hand. The server picks a finished heads-up hand that holds a
   preflop decision worth grading and says which seat and which action in the
   log it is; this page replays the log up to that point with the engine and
   asks what you would have done.

   The engine carries the hand evaluator's lookup table, so this route is lazy
   loaded from index.tsx for the same reason the replay page is. Everything the
   page shows about the spot comes out of the replay rather than out of the
   payload: the pot, the price and the stacks are what the engine says they
   were, not numbers the server wrote down and could get wrong. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { replay } from '@opentable/engine';
import type { HandConfig } from '@opentable/engine';
import { api, ApiError } from '../net/api.ts';
import type { PuzzleHand } from '../net/types.ts';
import { BoardText } from '../ui/board-text.tsx';
import { useTitle } from '../ui/title.ts';
import { KeyHint, ScoreRow, useAnswerKeys, Verdict } from './bits.tsx';
import { SPOT_COPY, actionsFor, chartFor, labelFor, scoreDecision, type Action, type Bucket, type Spot } from './chart.ts';
import { afterAnswer, emptyPuzzles, readPuzzles, writePuzzles, type Puzzles } from './store.ts';

interface Spotlight {
  pot: number;
  toCall: number;
  stack: number;
}

/* The hand as it stood when the decision was made. Heads-up hands are stored
   in table seats and the engine's dense index is the same one, which is what
   lets the stored log be replayed as it stands. */
function readSpot(puzzle: PuzzleHand): Spotlight | null {
  const config: HandConfig = {
    seats: puzzle.stacksStart.map((stack, seat) => ({ id: `seat-${seat}`, stack })),
    button: puzzle.button,
    sb: puzzle.sb,
    bb: puzzle.bb,
    seed: puzzle.seed,
  };
  try {
    const states = replay(config, puzzle.actions.slice(0, puzzle.logIndex));
    const state = states[states.length - 1];
    const seat = state.seats[puzzle.seat];
    if (!seat) return null;
    return {
      pot: state.seats.reduce((sum, s) => sum + s.committed, 0),
      toCall: Math.max(0, state.currentBet - seat.bet),
      stack: seat.stack,
    };
  } catch {
    return null;
  }
}

export function RealHand() {
  const [puzzles, setPuzzles] = useState<Puzzles>(() => emptyPuzzles());
  const [puzzle, setPuzzle] = useState<PuzzleHand | null>(null);
  const [error, setError] = useState<'none' | 'failed' | null>(null);
  const [answer, setAnswer] = useState<Action | null>(null);
  useTitle('From a real hand');

  useEffect(() => setPuzzles(readPuzzles()), []);

  const load = useCallback(() => {
    setPuzzle(null);
    setAnswer(null);
    setError(null);
    api
      .puzzleHand()
      .then(setPuzzle)
      .catch((e: Error) => setError(e instanceof ApiError && e.status === 404 ? 'none' : 'failed'));
  }, []);

  useEffect(load, [load]);

  const tally = puzzles.types.hand;
  const spot = puzzle ? (puzzle.spot as Spot) : null;
  const bucket = puzzle ? (puzzle.bucket as Bucket) : null;
  const choices = spot && bucket ? actionsFor(chartFor(bucket, spot)) : [];

  const answerWith = useCallback(
    (action: Action) => {
      if (!puzzle || answer !== null) return;
      setAnswer(action);
      const right = scoreDecision({
        bucket: puzzle.bucket as Bucket,
        spot: puzzle.spot as Spot,
        hand: puzzle.hand,
        action,
      }).inRange;
      setPuzzles((prev) => {
        const updated = afterAnswer(prev, 'hand', right);
        writePuzzles(updated);
        return updated;
      });
    },
    [answer, puzzle],
  );

  const onChoose = useCallback((index: number) => answerWith(choices[index]), [answerWith, choices]);
  useAnswerKeys({ choices: choices.length, answered: answer !== null, onChoose, onNext: load });

  /* The replay is a run of the engine over the log, so it happens once per
     hand rather than once per render. */
  const read = useMemo(() => (puzzle ? readSpot(puzzle) : null), [puzzle]);

  if (error === 'none') {
    return (
      <Shell>
        <div className="card">
          <div className="empty">
            <span className="e-title">No hand to grade yet</span>
            <span className="e-desc">
              This puzzle needs a finished heads-up match with a preflop decision in it, and there is
              not one yet. The generated puzzles work without one.
            </span>
            <Link className="btn btn-secondary btn-sm" to="/puzzles/preflop">Try the preflop puzzles</Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (error === 'failed') {
    return (
      <Shell>
        <div className="card">
          <div className="empty">
            <span className="e-title">The hand did not load</span>
            <span className="e-desc">The server did not answer. Try again in a moment.</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Try again</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (!puzzle || !spot || !bucket) {
    return (
      <Shell>
        <span className="muted">Finding a hand</span>
      </Shell>
    );
  }

  const copy = SPOT_COPY[spot];
  const verdict = answer ? scoreDecision({ bucket, spot, hand: puzzle.hand, action: answer }) : null;
  const hero = puzzle.seats.find((s) => s.seat === puzzle.seat);
  const villain = puzzle.seats.find((s) => s.seat !== puzzle.seat);

  return (
    <Shell>
      <section className="card stack" aria-label="The spot">
        <div className="puzzle-board">
          <div className="field">
            <span className="label">The hand</span>
            <BoardText cards={puzzle.cards} />
          </div>
          <div className="field">
            <span className="label">Effective stack</span>
            <span className="puzzle-line">
              <span className="num">{Math.round(puzzle.effectiveBb)}</span> big blinds
            </span>
          </div>
          {read && (
            <div className="field">
              <span className="label">Pot and price</span>
              <span className="puzzle-line">
                <span className="num">{read.pot}</span>, <span className="num">{read.toCall}</span> to call,{' '}
                <span className="num">{read.stack}</span> behind
              </span>
            </div>
          )}
        </div>

        <p className="puzzle-line">
          You are {hero?.name ?? 'the player'} here, against {villain?.name ?? 'the other seat'}.{' '}
          {copy.question}
        </p>
        {!read && (
          <p className="muted">
            The stored log would not replay, so the pot and the price are not shown. The decision
            itself is still the one that was made.
          </p>
        )}

        {answer === null ? (
          <div className="row">
            {choices.map((action) => (
              <button key={action} type="button" className="btn btn-secondary" onClick={() => answerWith(action)}>
                {labelFor(spot, action)}
              </button>
            ))}
            <KeyHint answered={false} choices={choices.length} />
          </div>
        ) : (
          verdict && (
            <div className="stack">
              <Verdict right={verdict.inRange} text={verdict.inRange ? 'Right' : 'The chart disagrees'} />
              <dl className="puzzle-results">
                <div>
                  <dt>The chart says</dt>
                  <dd className="num">{labelFor(spot, verdict.best)}</dd>
                  <dd className="muted small">{puzzle.hand} in this spot</dd>
                </div>
                <div>
                  <dt>At the table</dt>
                  <dd className="num">{labelFor(spot, puzzle.played)}</dd>
                  <dd className="muted small">What was actually done</dd>
                </div>
                <div>
                  <dt>Cost of the difference</dt>
                  <dd className="num">{verdict.evLost.toFixed(2)}</dd>
                  <dd className="muted small">Big blinds against the baseline</dd>
                </div>
              </dl>
              <p className="muted">
                The baseline is heuristic, so this is agreement with a chart rather than a solve.
                Read the rest of the hand in the replay.
              </p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={load}>
                  Find another hand
                </button>
                <Link className="btn btn-secondary" to={`/m/${puzzle.matchId}/h/${puzzle.number}`}>
                  Open the replay
                </Link>
                <KeyHint answered choices={choices.length} />
              </div>
            </div>
          )
        )}
      </section>

      <ScoreRow tally={tally} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page stack puzzles-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">From a real hand</h1>
        <p className="muted">
          A preflop decision somebody actually faced here, replayed up to the moment it was made.
          Say what you would do, then read the rest of the hand. Graded against the same baseline
          chart as the rest of the site, explained in <Link to="/learn/ranges">the ranges lesson</Link>.
        </p>
      </div>
      {children}
      <p className="muted">
        <Link to="/puzzles">Back to puzzles</Link>.
      </p>
    </main>
  );
}

export default RealHand;
