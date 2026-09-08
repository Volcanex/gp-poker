/* The puzzles section: pages that ask a question rather than compute an
   answer for you. Everything here is graded honestly from code this site
   already has. There is no solver, so there is no puzzle whose answer would
   need one: the showdown is settled by the evaluator that settles pots, the
   preflop spots are graded against the baseline chart that grades a finished
   match, and the real-hand puzzle is the same chart over a hand somebody
   actually played.

   puzzlesRoutes is what app.tsx mounts. A new puzzle is one file plus one
   line, and the router never has to know what a puzzle is. */

import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTitle } from '../ui/title.ts';
import { Preflop } from './preflop-page.tsx';
import { Showdown } from './showdown-page.tsx';
import { accuracyOf, emptyPuzzles, readPuzzles, type Puzzles, type PuzzleType } from './store.ts';
import './puzzles.css';

/* The real-hand puzzle runs the engine, and the engine carries a hand
   evaluator with a large lookup table. Splitting it here keeps that table out
   of the bundle everyone loads, the same bargain the replay route makes. */
const RealHand = lazy(() => import('./hand-page.tsx').then((m) => ({ default: m.RealHand })));

export const puzzlesRoutes: { path: string; element: React.ReactNode }[] = [
  { path: '/puzzles', element: <PuzzlesIndex /> },
  { path: '/puzzles/showdown', element: <Showdown /> },
  { path: '/puzzles/preflop', element: <Preflop /> },
  {
    path: '/puzzles/hand',
    element: (
      <Suspense fallback={<main className="page"><span className="muted">Loading the puzzle</span></main>}>
        <RealHand />
      </Suspense>
    ),
  },
];

interface Entry {
  to: string;
  title: string;
  desc: string;
  type: PuzzleType | null;
}

const PUZZLES: Entry[] = [
  {
    to: '/puzzles/showdown',
    title: 'Who wins',
    desc: 'A finished board and two to four hands. Pick the winner, or say split, and read every hand back.',
    type: 'showdown',
  },
  {
    to: '/puzzles/preflop',
    title: 'Preflop, heads-up',
    desc: 'A stack depth, a position and two cards. Raise, call or fold, graded against the baseline chart.',
    type: 'preflop',
  },
  {
    to: '/tools/odds',
    title: 'Read the odds',
    desc: 'A price in front of you and one question: is your equity bigger than the share of the pot it costs?',
    type: null,
  },
  {
    to: '/puzzles/hand',
    title: 'From a real hand',
    desc: 'A preflop decision somebody actually faced here, replayed to the moment it was made.',
    type: 'hand',
  },
];

export function PuzzlesIndex() {
  const [puzzles, setPuzzles] = useState<Puzzles>(() => emptyPuzzles());
  useTitle('Puzzles');

  useEffect(() => setPuzzles(readPuzzles()), []);

  return (
    <main className="page stack puzzles-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Puzzles</h1>
        <p className="muted">
          Four questions worth answering every day. Nothing here is a solver: a showdown is settled
          by the evaluator that settles pots at the table, and a preflop spot is graded against the
          same heuristic baseline chart your finished matches are scored with.
        </p>
      </div>

      <section className="card daily" aria-label="Today">
        <span className="big">{puzzles.solvedToday}</span>
        <div className="stack" style={{ gap: 0 }}>
          <span className="label">Solved today</span>
          <span className="muted">
            {puzzles.solvedToday === 0
              ? 'Nothing yet. Any puzzle below counts.'
              : 'Right answers only, and it resets at midnight.'}
          </span>
        </div>
      </section>

      <div className="puzzle-list">
        {PUZZLES.map((entry) => {
          const tally = entry.type ? puzzles.types[entry.type] : null;
          return (
            <Link className="card puzzle-card" to={entry.to} key={entry.to}>
              <span className="card-title">{entry.title}</span>
              <span className="muted">{entry.desc}</span>
              {tally && tally.total === 0 && <span className="meta">Not started</span>}
              {tally && tally.total > 0 && (
                <span className="meta">
                  <span>
                    Streak <span className="num">{tally.streak}</span>
                  </span>
                  <span>
                    Accuracy <span className="num">{accuracyOf(tally).toFixed(0)}%</span>
                  </span>
                  <span>
                    Solved <span className="num">{tally.total}</span>
                  </span>
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <p className="muted">
        Every puzzle links to the lesson that teaches it. If none of it makes sense yet, start with{' '}
        <Link to="/learn">Learn</Link> and come back.
      </p>
    </main>
  );
}

export { Showdown } from './showdown-page.tsx';
export { Preflop } from './preflop-page.tsx';
