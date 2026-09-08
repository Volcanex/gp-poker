import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { LiveMatch } from '../net/types.ts';
import { MODE_NAME } from '../ui/mode-tabs.tsx';
import { useTitle } from '../ui/title.ts';
import { StakeBadge, ago } from './feed.tsx';
import './home.css';

/* Tables in progress. Watching one is not built yet, so every row goes to the
   match page, which shows the hands already finished and keeps updating as
   more do. The list refreshes on the same clock as the home strip. */

const REFRESH_MS = 10_000;

export function Watch() {
  const [list, setList] = useState<LiveMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  useTitle('Watch');

  useEffect(() => {
    let live = true;
    const load = () => {
      api
        .live()
        .then((rows) => {
          if (!live) return;
          setList(rows);
          setFailed(false);
        })
        .catch(() => live && setFailed(true));
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const empty = failed || (list !== null && list.length === 0);

  return (
    <main className="page stack">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Watch</h1>
        <p className="muted">
          Tables being played right now. Spectating is coming. Open a match to see its hand history.
        </p>
      </div>

      <div className="card feed-card">
        {empty ? (
          <div className="empty">
            <span className="e-title">{failed ? 'The list did not load' : 'No tables running'}</span>
            <span className="e-desc">
              {failed ? 'Reload to try again.' : 'Start a match from the home page and this fills up.'}
            </span>
            {!failed && (
              <Link className="btn btn-secondary btn-sm" to="/">
                Start a match
              </Link>
            )}
          </div>
        ) : (
          (list ?? []).map((m) => (
            <div className="feed-row" key={m.id}>
              <Link className="row-link" to={`/m/${m.id}`} aria-label={`Match ${m.id}`} />
              <span className="tagset">
                <span className="badge badge-plain">{MODE_NAME[m.mode]}</span>
                <StakeBadge rated={m.rated} practice={m.practice} />
              </span>
              <span className="feed-players">
                {m.players.map((p, i) => (
                  <span className="name" key={`${p.name}-${i}`}>
                    <Link to={`/u/${encodeURIComponent(p.name)}`}>{p.name}</Link>
                    {p.bot && <span className="bot-tag">bot</span>}
                    {i < m.players.length - 1 && (
                      <span className="punct" aria-hidden="true">
                        ,
                      </span>
                    )}
                  </span>
                ))}
              </span>
              <span className="feed-meta">
                <span>hand {m.hand}</span>
                <span>started {ago(m.startedAt)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
