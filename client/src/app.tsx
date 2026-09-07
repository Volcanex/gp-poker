import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './net/session.tsx';
import { Home } from './routes/home.tsx';
import { Match } from './routes/match.tsx';
import { HandReplay, Profile } from './routes/raw.tsx';
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
  const { me } = useSession();
  return (
    <header className="top">
      <Link className="wordmark" to="/">Open Table</Link>
      <nav>
        <NavLink to="/" end>Play</NavLink>
        <NavLink to="/#leaderboard">Leaderboard</NavLink>
      </nav>
      <span className="spacer" />
      {me && (
        <Link className="whoami" to={`/u/${encodeURIComponent(me.name)}`}>
          <span>{me.name}</span>
          <span className="r num">{me.rating}{me.provisional ? '?' : ''}</span>
        </Link>
      )}
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
          <Route path="/m/:id" element={<Match />} />
          <Route path="/m/:id/h/:n" element={<HandReplay />} />
          <Route path="/u/:name" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
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
