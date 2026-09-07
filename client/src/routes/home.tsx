import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, rows } from '../net/api.ts';
import type { LeaderboardRow } from '../net/api.ts';
import { useSession } from '../net/session.tsx';
import { elapsed, useNow } from '../ui/bits.tsx';
import { useLocation } from 'react-router-dom';

export function Home() {
  const { queue, startQueue, cancelQueue, offline, ready, conn } = useSession();
  const nav = useNavigate();
  const searching = queue.s === 'searching';
  const { hash } = useLocation();
  const now = useNow(searching, 250);

  useEffect(() => {
    if (queue.s === 'found' && queue.m) nav(`/m/${queue.m}`);
  }, [queue.s, queue.m, nav]);

  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <main className="page stack">
      <section className="hero">
        <h1 className="h1">Ranked heads-up hold'em</h1>
        <p className="lede">
          One opponent, twenty-five hands, <b>no money anywhere</b>. Chips are table units that
          reset every match. The only thing you keep is your rating.
        </p>

        {offline && ready && (
          <div className="card" role="status">
            <div className="empty">
              <span className="e-title">The table server is not answering</span>
              <span className="e-desc">
                Matchmaking is unavailable until it is back. Reload to try the connection again.
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => location.reload()}>
                Try again
              </button>
            </div>
          </div>
        )}

        {!searching ? (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!ready || offline}
            onClick={startQueue}
          >
            Play rated
          </button>
        ) : (
          <div className="searching">
            <span className="spinner" aria-hidden="true" />
            <span className="el num">Searching {elapsed(now - queue.since)}</span>
            {queue.range != null && (
              <span className="badge badge-plain num">Within {queue.range} rating</span>
            )}
            {queue.w != null && queue.w > 0 && (
              <span className="badge badge-plain num">{queue.w} waiting</span>
            )}
            <button type="button" className="btn btn-tertiary btn-sm" onClick={cancelQueue}>
              Cancel search
            </button>
          </div>
        )}

        {!offline && conn === 'waiting' && (
          <span className="muted">Connection dropped. Reconnecting.</span>
        )}
      </section>

      <section className="how">
        <div className="card">
          <span className="k">1</span>
          <span className="t">No money, ever</span>
          <span className="muted">No buy-ins, no rake, no ads. Nothing to purchase.</span>
        </div>
        <div className="card">
          <span className="k">2</span>
          <span className="t">Chips reset every match</span>
          <span className="muted">Both players start on 200 units at blinds 1 and 2.</span>
        </div>
        <div className="card">
          <span className="k">3</span>
          <span className="t">Rating is the score</span>
          <span className="muted">Glicko-2, updated once per match. That is the whole ladder.</span>
        </div>
      </section>

      <Leaderboard />
    </main>
  );
}

function Leaderboard() {
  const [list, setList] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .leaderboard()
      .then((p) => live && setList(rows(p).slice(0, 10)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="stack" id="leaderboard" style={{ gap: 'var(--sp-3)' }}>
      <div className="lb-head">
        <span className="h2">Top ten</span>
        <span className="muted">Rating, with the deviation beside it</span>
      </div>
      <div className="card lb-card">
        {failed || (list && list.length === 0) ? (
          <div className="empty">
            <span className="e-title">No ratings yet</span>
            <span className="e-desc">The board fills in as rated matches finish.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Top rated players">
              <thead>
                <tr>
                  <th className="r" style={{ width: 34 }}>#</th>
                  <th>Player</th>
                  <th className="r">Rating</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? placeholder).map((r, i) => (
                  <tr key={r.name || i}>
                    <td className="r">{i + 1}</td>
                    <td>
                      {list ? r.name : <span className="skeleton skeleton-text" style={{ width: 96 }} />}
                    </td>
                    <td className="r">
                      {list ? (
                        <>
                          {r.rating}
                          {r.rd != null && <span className="rd num">±{Math.round(r.rd)}</span>}
                        </>
                      ) : (
                        <span className="skeleton skeleton-text" style={{ width: 48 }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const placeholder: LeaderboardRow[] = Array.from({ length: 5 }, (_, i) => ({
  name: `row-${i}`,
  rating: 0,
  rd: 0,
}));
