/* The tools section: pages that compute rather than play. They share the
   analysis worker with the table, so nothing here talks to the server at all.

   toolsRoutes is what app.tsx mounts. Keeping the list here means a new tool is
   one file plus one line, and the router never has to know what a tool is. */

import type { Icon } from '@phosphor-icons/react';
import { Compass, GridFour, Percent } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTitle } from '../ui/title.ts';
import { Explorer } from './explorer.tsx';
import { Odds } from './odds.tsx';
import { Ranges } from './ranges.tsx';
import './tools.css';

export const toolsRoutes: { path: string; element: React.ReactNode }[] = [
  { path: '/tools', element: <Tools /> },
  { path: '/tools/ranges', element: <Ranges /> },
  { path: '/tools/odds', element: <Odds /> },
  { path: '/tools/explorer', element: <Explorer /> },
];

/* The same icon its matching lesson carries, where there is one: the range
   explorer and the odds trainer are the practice link `learn/lessons.ts`
   sends each lesson to, so the grid and the percentage sign already mean
   this tool before they get here. */
const TOOLS: { to: string; title: string; desc: string; Icon: Icon }[] = [
  {
    to: '/tools/explorer',
    title: 'Opening explorer',
    desc: 'Every hand played here, by starting hand: what the table raised, called and folded, and how it went.',
    Icon: Compass,
  },
  {
    to: '/tools/ranges',
    title: 'Range explorer',
    desc: 'Paint a range on the 13 by 13 grid, read it back as notation, and run any hand against it.',
    Icon: GridFour,
  },
  {
    to: '/tools/odds',
    title: 'Pot odds trainer',
    desc: 'A spot and a price. Call or fold, then see the equity, the outs and what the call needed.',
    Icon: Percent,
  },
];

export function Tools() {
  useTitle('Tools');
  return (
    <main className="page stack tools-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Tools</h1>
        <p className="muted">
          Two calculators that run entirely in your browser and one book that reads the site's own
          hands back. Nothing here is a solver: the ranges are heuristic baselines, the equities are
          against random hands unless you say otherwise, and the explorer is a record of what people
          did rather than advice about what to do.
        </p>
      </div>
      <div className="tool-list">
        {TOOLS.map((tool) => (
          <Link className="card tool-card" to={tool.to} key={tool.to}>
            <span className="card-title">
              <tool.Icon size={16} aria-hidden="true" />
              {tool.title}
            </span>
            <span className="muted">{tool.desc}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

export { Ranges } from './ranges.tsx';
export { Odds } from './odds.tsx';
export { Explorer } from './explorer.tsx';
