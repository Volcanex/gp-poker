import { Link, useLocation } from 'react-router-dom';
import '../routes/home.css';

/* Everywhere but the table. The table screen is a fixed column of header,
   felt and dock, and nothing may be added below it: see client/CLAUDE.md on
   the one footprint. */
export function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/m/')) return null;

  return (
    <footer className="site-foot">
      <span>
        EveryonePoker, free ranked poker. <Link to="/learn/fair">Provably fair</Link>, no money.
      </span>
      <Link to="/about">About</Link>
      <Link to="/leaderboard">Leaderboard</Link>
      <a href="https://github.com/Volcanex/gp-poker" target="_blank" rel="noreferrer">
        Source
      </a>
    </footer>
  );
}
