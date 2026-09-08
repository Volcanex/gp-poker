import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { FeedMatch, LiveMatch } from '../net/types.ts';
import { MODE_NAME } from '../ui/mode-tabs.tsx';
import { Flag } from '../ui/flag.tsx';
import { useTitle } from '../ui/title.ts';
import { MatchRow, StakeBadge, ago } from './feed.tsx';
import './home.css';

/* Every table being played, and the ones that have just stopped. A row here
   opens the match as a spectator: the same felt the players are looking at,
   with no seat and every hole card face down until it is shown down.

   Faster than the home strip on purpose. This is the page somebody sits on
   waiting for a table to appear, so a five second clock is the difference
   between watching a hand and reading about it afterwards. */

const REFRESH_MS = 5_000;
const RECENT_ROWS = 8;

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
          Tables being played right now. Open one to follow it hand by hand. Hole cards stay face
          down until they are shown down, the same as for the players.
        </p>
      </div>

      <div className="card feed-card">
        {empty ? (
          <div className="empty">
            <span className="e-title">
              {failed ? 'The list did not load' : 'Nothing is being played right now'}
            </span>
            <span className="e-desc">
              {failed ? 'Reload to try again.' : 'Start a match and it will show here.'}
            </span>
            {!failed && (
              <Link className="btn btn-secondary btn-sm" to="/">
                Start a match
              </Link>
            )}
          </div>
        ) : (
          (list ?? []).map((m) => <LiveRow key={m.id} match={m} />)
        )}
      </div>

      <RecentlyFinished />
    </main>
  );
}

function LiveRow({ match }: { match: LiveMatch }) {
  return (
    <div className="feed-row">
      <Link className="row-link" to={`/m/${match.id}`} aria-label={`Watch match ${match.id}`} />
      <span className="tagset">
        <span className="badge badge-plain">{MODE_NAME[match.mode]}</span>
        <StakeBadge
          rated={match.rated}
          practice={match.practice}
          homeGame={match.homeGame === true}
          arena={match.arena ?? null}
        />
      </span>
      <span className="feed-players">
        {match.players.map((p, i) => (
          <span className="name" key={`${p.name}-${i}`}>
            {p.country && <Flag code={p.country} size={16} />}
            <Link to={`/u/${encodeURIComponent(p.name)}`}>{p.name}</Link>
            {p.bot && <span className="bot-tag">bot</span>}
            {p.rating != null && <span className="rating num">{p.rating}</span>}
            {i < match.players.length - 1 && (
              <span className="punct" aria-hidden="true">
                ,
              </span>
            )}
          </span>
        ))}
      </span>
      <span className="feed-meta">
        <span>hand {match.hand}</span>
        {match.spectators != null && match.spectators > 0 && (
          <span>{match.spectators} watching</span>
        )}
        <span>started {ago(match.startedAt)}</span>
      </span>
      {/* The whole row is already a link. This one is the affordance: it says
          what the row does, which "match 7f3k" on its own does not. */}
      <Link className="btn btn-secondary btn-sm watch-go" to={`/m/${match.id}`}>
        Watch
      </Link>
    </div>
  );
}

function RecentlyFinished() {
  const [list, setList] = useState<FeedMatch[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .recent(RECENT_ROWS)
      .then((rows) => live && setList(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const empty = failed || (list !== null && list.length === 0);

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="feed-head">
        <span className="h2">Recently finished</span>
        <span className="muted">Every match has a permanent page</span>
      </div>
      <div className="card feed-card">
        {empty ? (
          <div className="empty">
            <span className="e-title">{failed ? 'The list did not load' : 'No matches yet'}</span>
            <span className="e-desc">
              {failed ? 'Reload to try again.' : 'This fills in as matches finish.'}
            </span>
          </div>
        ) : (
          (list ?? []).map((m) => <MatchRow key={m.id} match={m} />)
        )}
      </div>
    </section>
  );
}
