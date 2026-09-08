/* Preflop, heads-up. One spot from the baseline charts, one decision.

   What is graded here is agreement with a heuristic chart, and the page says
   so under every answer rather than in a footnote. There is no solver behind
   Open Table and pretending otherwise would be the dishonest part; the chart
   is still the same one the accuracy figure on a finished match is measured
   against, so practising against it is practising against the thing that
   scores you. */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BoardText } from '../ui/board-text.tsx';
import { useGridEntrance } from '../ui/grid-entrance.ts';
import { useTitle } from '../ui/title.ts';
import { KeyHint, ScoreRow, useAnswerKeys, Verdict } from './bits.tsx';
import { BUCKET_WORDS, SPOT_COPY, bucketName, chartFor, labelFor, type Action } from './chart.ts';
import { RANKS, countRegions, dealPreflop, gradePreflop, gridFor, levelFor, type PreflopPuzzle } from './preflop.ts';
import { afterAnswer, emptyPuzzles, readPuzzles, writePuzzles, type Puzzles } from './store.ts';

export function Preflop() {
  const [puzzles, setPuzzles] = useState<Puzzles>(() => emptyPuzzles());
  const [puzzle, setPuzzle] = useState<PreflopPuzzle>(() => dealPreflop(0));
  const [answer, setAnswer] = useState<Action | null>(null);
  const answered = useRef(false);
  useTitle('Preflop puzzles');

  useEffect(() => setPuzzles(readPuzzles()), []);

  const tally = puzzles.types.preflop;

  const next = useCallback(() => {
    answered.current = false;
    setAnswer(null);
    setPuzzle(dealPreflop(levelFor(tally.streak)));
  }, [tally.streak]);

  const answerWith = useCallback(
    (action: Action) => {
      if (answered.current) return;
      answered.current = true;
      setAnswer(action);
      const right = gradePreflop(puzzle, action).right;
      setPuzzles((prev) => {
        const updated = afterAnswer(prev, 'preflop', right);
        writePuzzles(updated);
        return updated;
      });
    },
    [puzzle],
  );

  const onChoose = useCallback((index: number) => answerWith(puzzle.choices[index]), [answerWith, puzzle.choices]);
  useAnswerKeys({ choices: puzzle.choices.length, answered: answer !== null, onChoose, onNext: next });

  const copy = SPOT_COPY[puzzle.spot];
  const verdict = answer ? gradePreflop(puzzle, answer) : null;

  return (
    <main className="page stack puzzles-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Preflop, heads-up</h1>
        <p className="muted">
          A stack depth, a position and two cards. Say what the baseline chart says, and see where
          the hand sits on the grid afterwards. The charts are heuristic rather than solved, which is
          explained in <Link to="/learn/ranges">the ranges lesson</Link>.
        </p>
      </div>

      <section className="card stack" aria-label="The spot">
        <div className="puzzle-board">
          <div className="field">
            <span className="label">Your hand</span>
            <BoardText cards={puzzle.cards} />
          </div>
          <div className="field">
            <span className="label">Position</span>
            <span className="puzzle-line">{copy.position}</span>
          </div>
          <div className="field">
            <span className="label">Effective stack</span>
            <span className="puzzle-line">
              <span className="num">{puzzle.effectiveBb}</span> big blinds
            </span>
          </div>
        </div>

        <p className="puzzle-line">
          {copy.question} You are playing {BUCKET_WORDS[puzzle.bucket]}.
        </p>

        {answer === null ? (
          <div className="row">
            {puzzle.choices.map((action) => (
              <button
                key={action}
                type="button"
                className="btn btn-secondary"
                onClick={() => answerWith(action)}
              >
                {labelFor(puzzle.spot, action)}
              </button>
            ))}
            <KeyHint answered={false} choices={puzzle.choices.length} />
          </div>
        ) : (
          verdict && (
            <div className="stack">
              <Verdict right={verdict.right} text={verdict.right ? 'Right' : 'The chart disagrees'} />
              <dl className="puzzle-results">
                <div>
                  <dt>Your hand</dt>
                  <dd className="num">{puzzle.hand}</dd>
                  <dd className="muted small">One of the 169 starting classes</dd>
                </div>
                <div>
                  <dt>The chart says</dt>
                  <dd className="num">{labelFor(puzzle.spot, verdict.best)}</dd>
                  <dd className="muted small">{bucketName(puzzle.bucket)}, {copy.position.toLowerCase()}</dd>
                </div>
                <div>
                  <dt>Cost of the difference</dt>
                  <dd className="num">{verdict.evLost.toFixed(2)}</dd>
                  <dd className="muted small">Big blinds, on the same scale a match is scored with</dd>
                </div>
              </dl>
              <p className="muted">
                This is a hand-built baseline, not solver output, so treat a near miss as a nudge
                rather than a mistake. The same number is what the accuracy figure on a finished
                match is made of.
              </p>
              <ChartGrid puzzle={puzzle} />
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={next}>
                  Deal the next spot
                </button>
                <KeyHint answered choices={puzzle.choices.length} />
              </div>
            </div>
          )
        )}
      </section>

      <ScoreRow tally={tally} />

      <p className="muted">
        The hands get closer to the edge of the chart as the streak grows, which is where the
        decision is actually worth making. <Link to="/puzzles">Back to puzzles</Link>.
      </p>
    </main>
  );
}

function ChartGrid({ puzzle }: { puzzle: PreflopPuzzle }) {
  /* The chart is only ever on the page for one answer, and the next spot
     unmounts it, so it enters on mount and never needs a wave. The same
     radiating order the tools grids use: the two are the same object to a
     reader, whatever they are made of underneath. */
  const gridRef = useGridEntrance<HTMLDivElement>({ selector: '.chart-cell' });
  const grid = gridFor(puzzle.bucket, puzzle.spot);
  const counts = countRegions(grid);
  const chart = chartFor(puzzle.bucket, puzzle.spot);
  const shown: Action[] = ['aggr', 'passive', 'fold'].filter(
    (a) => a === 'fold' || chart[a as 'aggr' | 'passive'] !== undefined,
  ) as Action[];
  const summary = shown.map((a) => `${labelFor(puzzle.spot, a).toLowerCase()} ${counts[a]}`).join(', ');

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <span className="label">Where {puzzle.hand} sits in this spot</span>
      <span className="muted">
        Pairs run down the diagonal from aces, suited hands above it, offsuit below. Your hand is the
        outlined square.
      </span>
      <div className="chart-grid-wrap" tabIndex={0} role="group" aria-label="The chart for this spot">
        <div
          className="chart-grid"
          ref={gridRef}
          role="img"
          aria-label={`The chart for this spot, 13 by 13, ranks from ace down to two. Of the 169 classes it says ${summary}. For ${puzzle.hand} it says ${labelFor(puzzle.spot, puzzle.best).toLowerCase()}.`}
        >
          <span className="chart-head" />
          {RANKS.map((rank) => (
            <span className="chart-head" key={`col-${rank}`}>{rank}</span>
          ))}
          {grid.map((row, i) => (
            <Fragment key={RANKS[i]}>
              <span className="chart-head">{RANKS[i]}</span>
              {row.map((cell, j) => (
                <div
                  className="chart-cell"
                  key={cell.hand}
                  data-r={i}
                  data-c={j}
                  data-region={cell.region}
                  title={cell.hand}
                  {...(cell.hand === puzzle.hand ? { 'data-yours': '' } : {})}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        {shown.map((action) => (
          <span className="key" key={action}>
            <span className="sw" {...(action === 'fold' ? {} : { 'data-region': action })} />{' '}
            {labelFor(puzzle.spot, action)} <span className="num">{counts[action]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
