import type { ReactElement } from 'react';
import { Link, Route } from 'react-router-dom';
import { useTitle } from '../../ui/title.ts';
import { LESSONS } from './lessons.ts';
import { Rules } from './rules.tsx';
import { Hands } from './hands.tsx';
import { Positions } from './positions.tsx';
import { Odds } from './odds.tsx';
import { Ranges } from './ranges.tsx';
import { Rating } from './rating.tsx';
import { Fair } from './fair.tsx';
import { Formats } from './formats.tsx';
import './learn.css';

const PAGES: Record<string, () => ReactElement> = {
  rules: Rules,
  hands: Hands,
  positions: Positions,
  odds: Odds,
  ranges: Ranges,
  rating: Rating,
  fair: Fair,
  formats: Formats,
};

/* One route per lesson, built from the same list the index renders, so a
   lesson can never be listed without a page or shipped without a link. */
export const learnRoutes = [
  <Route key="learn" path="/learn" element={<LearnIndex />} />,
  ...LESSONS.map((l) => {
    const Page = PAGES[l.slug];
    return <Route key={l.slug} path={`/learn/${l.slug}`} element={<Page />} />;
  }),
];

export function LearnIndex() {
  useTitle('Learn');

  return (
    <main className="page stack learn-index">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Learn</h1>
        <p className="muted">
          Eight short pages, in order, from never having played to knowing how the rating and the
          shuffle work. Read them straight through or take the one you need. Nothing here costs
          anything, and none of it is a video.
        </p>
      </div>

      <div className="lesson-cards">
        {LESSONS.map((l, i) => (
          <div className="card lesson-card" key={l.slug}>
            <Link className="stretch" to={`/learn/${l.slug}`} aria-label={l.title} />
            <span className="n">{i + 1}</span>
            <span className="t">{l.title}</span>
            <span className="muted">{l.blurb}</span>
          </div>
        ))}
      </div>

      <p className="muted">
        Then go and play. Every match you finish has a page with its hands, and every hand can be
        replayed action by action.
      </p>
    </main>
  );
}
