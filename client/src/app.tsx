import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './net/session.tsx';
import { Home } from './routes/home.tsx';
import { Match } from './routes/match.tsx';
import { Leaderboard } from './routes/leaderboard.tsx';
import { Profile } from './routes/profile.tsx';
import { Watch } from './routes/watch.tsx';
import { Challenge } from './routes/challenge.tsx';
import { HomeGame } from './routes/home-game.tsx';
import { ArenaPage } from './routes/arena.tsx';
import { learnRoutes } from './routes/learn/index.tsx';
import { puzzlesRoutes } from './puzzles/index.tsx';
import { toolsRoutes } from './tools/index.tsx';
import { NotFound } from './routes/not-found.tsx';
import { AdminBar } from './admin/bar.tsx';
import { AccountMenu } from './ui/auth.tsx';
import { SettingsMenu } from './ui/settings.tsx';
import { SiteFooter } from './ui/site-footer.tsx';
import { MatchFoundAlert, PlayingPill } from './ui/presence.tsx';
import { sound } from './sound/index.ts';

/* The replay is the only page that runs the engine, and the engine carries a
   hand evaluator with a large lookup table. Splitting it here keeps that table
   out of the bundle everyone loads to play. */
const Replay = lazy(() => import('./routes/replay.tsx').then((m) => ({ default: m.Replay })));
/* Split for a different reason: nothing about the admin layer belongs in the
   bundle everybody downloads to play. */
const AdminTickets = lazy(() => import('./admin/tickets.tsx').then((m) => ({ default: m.AdminTickets })));
const AdminTicket = lazy(() => import('./admin/tickets.tsx').then((m) => ({ default: m.AdminTicket })));
import './app.css';

function TopBar() {
  return (
    <header className="top">
      <Link className="wordmark" to="/">Open Table</Link>
      <nav>
        <NavLink to="/" end>Play</NavLink>
        <NavLink to="/arena">Arena</NavLink>
        <NavLink to="/learn">Learn</NavLink>
        <NavLink to="/puzzles">Puzzles</NavLink>
        <NavLink to="/tools">Tools</NavLink>
        <NavLink to="/watch">Watch</NavLink>
        <NavLink to="/leaderboard">Leaderboard</NavLink>
      </nav>
      <span className="spacer" />
      <PlayingPill />
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
        <AdminBar />
        <TopBar />
        <MatchFoundAlert />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/arena" element={<ArenaPage />} />
          <Route path="/arena/:id" element={<ArenaPage />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/watch" element={<Watch />} />
          {learnRoutes}
          {puzzlesRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          {toolsRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="/c/:id" element={<Challenge />} />
          <Route path="/g/:id" element={<HomeGame />} />
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
          <Route
            path="/admin/tickets"
            element={
              <Suspense fallback={<main className="page"><span className="muted">Loading</span></main>}>
                <AdminTickets />
              </Suspense>
            }
          />
          <Route
            path="/admin/tickets/:id"
            element={
              <Suspense fallback={<main className="page"><span className="muted">Loading</span></main>}>
                <AdminTicket />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <SiteFooter />
      </SessionProvider>
    </BrowserRouter>
  );
}
