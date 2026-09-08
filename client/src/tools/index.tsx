/* The tools section: pages that compute rather than play. They share the
   analysis worker with the table, so nothing here talks to the server at all.

   toolsRoutes is what app.tsx mounts. Keeping the list here means a new tool is
   one file plus one line, and the router never has to know what a tool is. */

import { Link } from 'react-router-dom';
import { useTitle } from '../ui/title.ts';
import { Odds } from './odds.tsx';
import { Ranges } from './ranges.tsx';
import './tools.css';

export const toolsRoutes: { path: string; element: React.ReactNode }[] = [
  { path: '/tools', element: <Tools /> },
  { path: '/tools/ranges', element: <Ranges /> },
  { path: '/tools/odds', element: <Odds /> },
];

const TOOLS = [
  {
    to: '/tools/ranges',
    title: 'Range explorer',
    desc: 'Paint a range on the 13 by 13 grid, read it back as notation, and run any hand against it.',
  },
  {
    to: '/tools/odds',
    title: 'Pot odds trainer',
    desc: 'A spot and a price. Call or fold, then see the equity, the outs and what the call needed.',
  },
];

export function Tools() {
  useTitle('Tools');
  return (
    <main className="page stack tools-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Tools</h1>
        <p className="muted">
          Two calculators that run entirely in your browser. Nothing here is a solver: the ranges are
          heuristic baselines and the equities are against random hands unless you say otherwise.
        </p>
      </div>
      <div className="tool-list">
        {TOOLS.map((tool) => (
          <Link className="card tool-card" to={tool.to} key={tool.to}>
            <span className="card-title">{tool.title}</span>
            <span className="muted">{tool.desc}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

export { Ranges } from './ranges.tsx';
export { Odds } from './odds.tsx';
