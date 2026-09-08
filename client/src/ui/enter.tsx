import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/* How every page in this app arrives. One system, applied centrally, so a page
   never arranges its own entrance and a new page gets it by existing.

   `PageEnter` writes `data-enter` on the root element when the route is one
   that takes the entrance. Everything else is the contract in `../app.css`,
   which animates the direct children of the routed `<main class="page">`: each
   block slides in from the leading edge, in order, once. The full rules and the
   reasoning are in `CLAUDE.md`.

   Nothing under `/m` enters. The table, the match summary and the replay hold
   one footprint through a whole hand and their tests assert zero layout shift,
   so they keep the motion they already have and take none of this. */
export function pageEnters(pathname: string): boolean {
  return pathname !== '/m' && !pathname.startsWith('/m/');
}

/* A layout effect rather than an effect: it runs after React has put the new
   page in the document and before the browser paints it, so the first frame a
   reader sees is already the first frame of the entrance. Written on the root
   element rather than on the page, because the page belongs to whichever route
   is mounted and a lazy one arrives a beat after the route changes. */
export function PageEnter() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (pageEnters(pathname)) root.setAttribute('data-enter', '');
    else root.removeAttribute('data-enter');
  }, [pathname]);
  return null;
}

/* What a page shows while it is still fetching: the shape it is about to fill,
   at rest. A spinner says only that something is happening, and a placeholder
   that slides in is motion about nothing, so both blocks are held with
   `data-enter-ready="no"` and the entrance runs when the content replaces
   them. */
export function PageResting({ wide, label }: { wide?: boolean; label: string }) {
  return (
    <main className={wide ? 'page wide stack' : 'page stack'} aria-busy="true">
      <div className="stack resting-head" data-enter-ready="no">
        <span className="sr-only" role="status">{label}</span>
        <span className="skeleton skeleton-text" style={{ width: 180, height: 20 }} />
        <span className="skeleton skeleton-text" style={{ width: 300 }} />
      </div>
      <div className="card resting-card" data-enter-ready="no">
        <span className="skeleton skeleton-text" style={{ width: 220 }} />
        <span className="skeleton skeleton-text" style={{ width: 160 }} />
        <span className="skeleton skeleton-text" style={{ width: 190 }} />
      </div>
    </main>
  );
}
