import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Mode } from '@opentable/protocol';
import { api } from '../net/api.ts';
import type { LeaderboardRow } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { MODE_NAME, ModeTabs } from '../ui/mode-tabs.tsx';
import { int } from '../ui/format.ts';
import { Avatar } from '../ui/avatar.tsx';
import { avatarSeed, avatarVersion } from '../net/adapt.ts';

export function Leaderboard() {
  const { me, queue } = useSession();
  /* One ladder per mode. The board opens on the mode you last played or chose,
     which is the one the rest of the app is already showing you. */
  const [mode, setMode] = useState<Mode>(queue.mode);
  const [list, setList] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTitle('Leaderboard');

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    api
      .leaderboard(mode)
      .then((rows) => live && setList(rows))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [mode]);

  return (
    <main className="page wide stack">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Leaderboard</h1>
        <p className="muted">
          The top 100 by rating. A player joins the board once their deviation settles below 110,
          so provisional players are listed after a few rated matches. Each mode has its own
          ladder: a six-max result never moves a heads-up rating.
        </p>
        <ModeTabs mode={mode} onPick={setMode} label="Leaderboard mode" />
      </div>

      {error ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">The board did not load</span>
            <span className="e-desc">{error}. Reload to try again.</span>
          </div>
        </div>
      ) : list && list.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">No {MODE_NAME[mode].toLowerCase()} ratings yet</span>
            <span className="e-desc">The board fills in as rated matches in this mode finish.</span>
          </div>
        </div>
      ) : (
        <div className="card lb-card">
          <div className="table-wrap">
            <table className="table" aria-label={`Top rated ${MODE_NAME[mode].toLowerCase()} players`}>
              <thead>
                <tr>
                  <th className="r" style={{ width: 40 }}>#</th>
                  <th>Player</th>
                  <th className="r">Rating</th>
                  <th className="r">Matches</th>
                  <th className="r">Peak</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? PLACEHOLDER).map((r, i) => {
                  const mine = me != null && r.name === me.name;
                  return (
                    <tr key={r.name} data-mine={mine ? '' : undefined}>
                      <td className="r">{i + 1}</td>
                      <td>
                        {list ? (
                          <span className="player-cell">
                            <Avatar
                              seed={avatarSeed(r.id, r.name)}
                              name={r.name}
                              size={24}
                              avatarV={avatarVersion(r.avatarV)}
                            />
                            <Link to={`/u/${encodeURIComponent(r.name)}`}>{r.name}</Link>
                          </span>
                        ) : (
                          <span className="skeleton skeleton-text" style={{ width: 96 }} />
                        )}
                      </td>
                      <td className="r">
                        {list ? (
                          <>
                            {int(r.rating)}
                            <span className="rd num">+-{int(r.rd)}</span>
                          </>
                        ) : (
                          <span className="skeleton skeleton-text" style={{ width: 56 }} />
                        )}
                      </td>
                      <td className="r">{list ? r.matches : ''}</td>
                      <td className="r">{list ? int(r.peak) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

const PLACEHOLDER: LeaderboardRow[] = Array.from({ length: 8 }, (_, i) => ({
  name: `row-${i}`,
  rating: 0,
  rd: 0,
  matches: 0,
  peak: 0,
}));
