import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Cards, Eye, GraduationCap, PuzzlePiece, Ranking, Trophy, Wrench,
} from '@phosphor-icons/react';
import { AccountMenu } from './auth.tsx';
import { SettingsMenu } from './settings.tsx';
import { PlayingPill } from './presence.tsx';
import { useGInit } from './bits.tsx';

/* The site's persistent chrome: g-system's `.g-shell`, which is a sidebar of
   sections beside the page and, under 720px, the same sidebar as an off-canvas
   sheet behind a scrim. What the sheet does and how it moves is g's; what is
   here is which sections there are, where the account and the settings sit, and
   the one route that will not have a sidebar at all.

   That route is the table. `/m/...` sizes the felt, the dock and the hero band
   against the window and holds one footprint through a hand, so the sidebar is
   the sheet there at every width and the page keeps the pixels it had. The
   rule is one predicate, next to the two others that say the same thing about
   the same routes: `pageEnters` in enter.tsx and the guard in site-footer.tsx. */
export function sidebarIsSheet(pathname: string): boolean {
  return pathname.startsWith('/m/');
}

/* The sections, in the order they were in the top bar. Icons are Phosphor at
   the regular weight and 20px, and they are decoration: every row says its own
   name, so the icon is hidden from the reader that would otherwise say it
   twice. */
const SECTIONS = [
  { to: '/', end: true, label: 'Play', Icon: Cards },
  { to: '/arena', end: false, label: 'Arena', Icon: Trophy },
  { to: '/learn', end: false, label: 'Learn', Icon: GraduationCap },
  { to: '/puzzles', end: false, label: 'Puzzles', Icon: PuzzlePiece },
  { to: '/tools', end: false, label: 'Tools', Icon: Wrench },
  { to: '/watch', end: false, label: 'Watch', Icon: Eye },
  { to: '/leaderboard', end: false, label: 'Leaderboard', Icon: Ranking },
];

/* Whether the sidebar is a sheet right now, which is the sheet route or a
   window narrower than g-shell's breakpoint. It is asked in JavaScript and not
   only in CSS because two controls move between the sidebar and the top bar
   with it, and there is exactly one of each: the settings panel is a single
   popover that the profile page also opens by id, so a second copy hidden with
   a media query would be a second element with the same id. */
function useOffCanvas(sheet: boolean): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return sheet || narrow;
}

export function SiteShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const sheet = sidebarIsSheet(pathname);
  const offCanvas = useOffCanvas(sheet);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLElement>(null);
  /* The hamburger is g's `list` icon, injected by g-ui.js from the data
     attribute, so the morph to an x that g.css animates on aria-expanded is
     the shipped one rather than a second drawing of it. */
  useGInit(barRef);

  /* Closing returns the focus to the control that opened it, whether the
     reader pressed Escape, dismissed the scrim or followed a link out. */
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const wasOpen = useRef(false);
  wasOpen.current = open;
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (wasOpen.current) close();
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /* A sheet that is shut is off the screen but still in the document, so it
     leaves the tab order and the accessibility tree rather than parking seven
     links and an account behind the page. */
  const shut = offCanvas && !open;

  return (
    <div className="site" data-sheet={sheet ? '' : undefined} data-nav-open={open ? '' : undefined}>
      <header className="top" ref={barRef}>
        <button
          type="button"
          ref={toggleRef}
          className="btn btn-tertiary btn-sm btn-icon g-nav-toggle"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="site-nav"
          data-icon="list"
          onClick={() => (open ? close() : setOpen(true))}
        />
        <Link className="wordmark" to="/">Open Table</Link>
        <span className="spacer" />
        <PlayingPill />
        {offCanvas && <AccountMenu />}
        {offCanvas && <SettingsMenu />}
      </header>

      <div className="g-shell shell">
        <aside id="site-nav" inert={shut}>
          <div className="side-in">
            <nav aria-label="Sections">
              {SECTIONS.map(({ to, end, label, Icon }) => (
                <NavLink key={to} className="nav-item" to={to} end={end}>
                  <Icon size={20} aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>
            {!offCanvas && (
              <div className="side-foot">
                <AccountMenu />
                <SettingsMenu />
              </div>
            )}
          </div>
        </aside>

        <div className="shell-main">{children}</div>

        <div className="g-scrim" onClick={close} />
      </div>
    </div>
  );
}
