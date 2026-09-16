import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './net/session.tsx';
import { FriendsProvider } from './net/friends.tsx';
import { Home } from './routes/home.tsx';
import { Match } from './routes/match.tsx';
import { Leaderboard } from './routes/leaderboard.tsx';
import { Profile } from './routes/profile.tsx';
import { Watch } from './routes/watch.tsx';
import { FriendsPage } from './routes/friends.tsx';
import { Challenge } from './routes/challenge.tsx';
import { HomeGame } from './routes/home-game.tsx';
import { ArenaPage } from './routes/arena.tsx';
import { Tournaments } from './routes/tournaments.tsx';
import { TournamentPage } from './routes/tournament.tsx';
import { BotsPage } from './routes/bots.tsx';
import { learnRoutes } from './routes/learn/index.tsx';
import { puzzlesRoutes } from './puzzles/index.tsx';
import { toolsRoutes } from './tools/index.tsx';
import { NotFound } from './routes/not-found.tsx';
import { SiteShell } from './ui/shell.tsx';
import { SiteFooter } from './ui/site-footer.tsx';
import { PageEnter } from './ui/enter.tsx';
import { MatchFoundAlert } from './ui/presence.tsx';
import { GoogleAuthResult } from './ui/auth.tsx';
import { ReadyCheckDialog } from './ui/ready-check.tsx';
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
/* After app.css on purpose: the room re-declares tokens the palettes, the
   accents and look-v2.css also declare, and wins on order. */
import './room.css';

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
        {/* Inside the session and outside the shell: the friends list needs an
            account before it can ask for anything, and the shell's own badge
            and every page under it read the same copy of it. */}
        <FriendsProvider>
          <SiteShell>
            <PageEnter />
            <MatchFoundAlert />
            {/* Renders nothing: the Google callback lands on whatever page the
                flow was started from, so what it says has to be mounted on
                all of them. */}
            <GoogleAuthResult />
            <ReadyCheckDialog />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/arena" element={<ArenaPage />} />
              <Route path="/arena/:id" element={<ArenaPage />} />
              <Route path="/tournaments" element={<Tournaments />} />
              <Route path="/t/:id" element={<TournamentPage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/watch" element={<Watch />} />
              <Route path="/friends" element={<FriendsPage />} />
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
          </SiteShell>
        </FriendsProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
