import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './net/session.tsx';
import { Home } from './routes/home.tsx';
import { Match } from './routes/match.tsx';
import { Leaderboard } from './routes/leaderboard.tsx';
import { Profile } from './routes/profile.tsx';
import { Watch } from './routes/watch.tsx';
import { learnRoutes } from './routes/learn/index.tsx';
import { toolsRoutes } from './tools/index.tsx';
import { AccountMenu } from './ui/auth.tsx';
import { SiteFooter } from './ui/site-footer.tsx';

/* The replay is the only page that runs the engine, and the engine carries a
   hand evaluator with a large lookup table. Splitting it here keeps that table
   out of the bundle everyone loads to play. */
const Replay = lazy(() => import('./routes/replay.tsx').then((m) => ({ default: m.Replay })));
import './app.css';

type Theme = 'dark' | 'light' | 'system';
const NEXT: Record<Theme, Theme> = { dark: 'light', light: 'system', system: 'dark' };
const LABEL: Record<Theme, { long: string; short: string }> = {
  dark: { long: 'Use light theme', short: 'Light' },
  light: { long: 'Follow the system theme', short: 'System' },
  system: { long: 'Use dark theme', short: 'Dark' },
};

function ThemeButton() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setTheme(attr === 'light' || attr === 'system' ? attr : 'dark');
  }, []);

  const flip = () => {
    const next = NEXT[theme];
    window.g?.theme(next);
    setTheme(next);
  };

  return (
    <button type="button" className="btn btn-tertiary btn-sm theme-btn" onClick={flip}>
      <span className="long">{LABEL[theme].long}</span>
      <span className="short">{LABEL[theme].short}</span>
    </button>
  );
}

function TopBar() {
  return (
    <header className="top">
      <Link className="wordmark" to="/">Open Table</Link>
      <nav>
        <NavLink to="/" end>Play</NavLink>
        <NavLink to="/learn">Learn</NavLink>
        <NavLink to="/tools">Tools</NavLink>
        <NavLink to="/watch">Watch</NavLink>
        <NavLink to="/leaderboard">Leaderboard</NavLink>
      </nav>
      <span className="spacer" />
      <AccountMenu />
      <ThemeButton />
    </header>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <TopBar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/watch" element={<Watch />} />
          {learnRoutes}
          {toolsRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="/m/:id" element={<Match />} />
          <Route
            path="/m/:id/h/:n"
            element={
              <Suspense fallback={<main className="page"><span className="muted">Loading the replay</span></main>}>
                <Replay />
              </Suspense>
            }
          />
          <Route path="/u/:name" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <SiteFooter />
      </SessionProvider>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <main className="page">
      <div className="card">
        <div className="empty">
          <span className="e-title">No page here</span>
          <span className="e-desc">The link may be old. Start a match from the home page.</span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </div>
    </main>
  );
}
