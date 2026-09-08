import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './net/session.tsx';
import { Home } from './routes/home.tsx';
import { Match } from './routes/match.tsx';
import { Leaderboard } from './routes/leaderboard.tsx';
import { Profile } from './routes/profile.tsx';
import { Watch } from './routes/watch.tsx';
import { Challenge } from './routes/challenge.tsx';
import { learnRoutes } from './routes/learn/index.tsx';
import { toolsRoutes } from './tools/index.tsx';
import { AccountMenu } from './ui/auth.tsx';
import { SettingsMenu } from './ui/settings.tsx';
import { SiteFooter } from './ui/site-footer.tsx';
import { sound } from './sound/index.ts';

/* The replay is the only page that runs the engine, and the engine carries a
   hand evaluator with a large lookup table. Splitting it here keeps that table
   out of the bundle everyone loads to play. */
const Replay = lazy(() => import('./routes/replay.tsx').then((m) => ({ default: m.Replay })));
import './app.css';

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
      <SettingsMenu />
    </header>
  );
}

/* A browser will not let a page make a noise until somebody has touched it, so
   the first gesture anywhere is what opens the audio context. Once is enough,
   and it costs nothing when the sound is off. */
function useSoundUnlock() {
  useEffect(() => {
    const open = () => { void sound.unlock(); };
    const opts = { once: true, passive: true } as const;
    window.addEventListener('pointerdown', open, opts);
    window.addEventListener('keydown', open, opts);
    return () => {
      window.removeEventListener('pointerdown', open);
      window.removeEventListener('keydown', open);
    };
  }, []);
}

export function App() {
  useSoundUnlock();
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
          <Route path="/c/:id" element={<Challenge />} />
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
