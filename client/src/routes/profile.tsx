import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../net/api.ts';
import type { Profile as ProfileData } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { RatingGraph } from '../ui/rating-graph.tsx';
import { fmtDate, fmtPct, int, ratingWithRd, signed } from '../ui/format.ts';
import { profileAccuracy, profileMatchCount } from '../net/adapt.ts';
import { ClaimCard } from '../ui/auth.tsx';

export function Profile() {
  const { name = '' } = useParams();
  const { me } = useSession();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTitle(data ? data.summary.name : name);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    api
      .user(name)
      .then(setData)
      .catch((e: Error) => setError(e instanceof ApiError && e.status === 404 ? 'notfound' : e.message));
  }, [name]);

  useEffect(load, [load]);

  if (error === 'notfound') {
    return (
      <main className="page">
        <div className="card">
          <div className="empty">
            <span className="e-title">No player called {name}</span>
            <span className="e-desc">The name may have changed. The leaderboard lists everyone rated.</span>
            <Link className="btn btn-secondary btn-sm" to="/leaderboard">See the leaderboard</Link>
          </div>
        </div>
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <div className="card">
          <div className="empty">
            <span className="e-title">The profile did not load</span>
            <span className="e-desc">{error}. Reload to try again.</span>
          </div>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page">
        <span className="muted">Loading</span>
      </main>
    );
  }

  const isMe = me != null && me.id === data.summary.id;
  const hasHands = data.stats.hands > 0;
  /* The profile payload carries no total match count for another player, only
     the last twenty. Rather than pass off a capped list as a total, the count
     is shown for your own profile and left out for everyone else. */
  const played = data.lastMatches.length > 0 || data.ratingHistory.length > 1;
  const accuracy = profileAccuracy(data);
  /* The endpoint's own total when it sends one; otherwise your own count from
     /api/me, and nothing at all for another player. */
  const matchCount = profileMatchCount(data) ?? (isMe && me ? me.matches : null);

  return (
    <main className="page wide stack">
      <header className="profile-head">
        <div className="profile-name">
          <h1 className="h1">{data.summary.name}</h1>
          <span className="profile-rating num">{ratingWithRd(data.summary.rating, data.summary.rd)}</span>
          {data.provisional && <span className="badge badge-warn">Provisional</span>}
        </div>
        {played ? (
          <div className="facts">
            <Fact k="Peak" v={String(int(data.peak))} d={data.peakAt ? fmtDate(data.peakAt) : 'Not set yet'} />
            {matchCount != null && <Fact k="Matches" v={String(matchCount)} d="rated" />}
            <Fact k="Win rate" v={fmtPct(data.winRate * 100, 0)} d="of decided matches" />
          </div>
        ) : (
          <span className="muted">No rated matches yet.</span>
        )}
      </header>

      {isMe && me?.guest && <ClaimCard onClaimed={load} />}

      <section className="stack" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Rating</span>
        <RatingGraph points={data.ratingHistory} />
      </section>

      <section className="stack" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Play style</span>
        {hasHands ? (
          <div className="tiles">
            <Tile k="VPIP" v={fmtPct(data.stats.vpip)} d="hands played voluntarily" />
            <Tile k="PFR" v={fmtPct(data.stats.pfr)} d="hands raised preflop" />
            <Tile k="Aggression" v={fmtPct(data.stats.aggressionFrequency * 100)} d="bets and raises of all actions" />
            <Tile k="Fold to 3bet" v={fmtPct(data.stats.foldTo3bet)} d="when facing a 3bet" />
            {accuracy != null && (
              <Tile k="Preflop accuracy" v={fmtPct(accuracy)} d="against the baseline charts" />
            )}
          </div>
        ) : (
          <div className="card">
            <div className="empty">
              <span className="e-title">No hands yet</span>
              <span className="e-desc">Style numbers appear after the first rated match.</span>
            </div>
          </div>
        )}
        <span className="muted">Over {data.stats.hands} hands.</span>
      </section>

      <section className="stack" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Recent matches</span>
        {data.lastMatches.length === 0 ? (
          <div className="card">
            <div className="empty">
              <span className="e-title">No matches yet</span>
              <span className="e-desc">Finished matches are listed here with their rating change.</span>
            </div>
          </div>
        ) : (
          <div className="card lb-card">
            <div className="table-wrap">
              <table className="table" aria-label="Recent matches">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opponent</th>
                    <th>Result</th>
                    <th className="r">Rating</th>
                    <th className="r">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lastMatches.map((m) => (
                    <tr key={m.id}>
                      <td>{fmtDate(m.finishedAt)}</td>
                      <td><Link to={`/u/${encodeURIComponent(m.opponent)}`}>{m.opponent}</Link></td>
                      <td>
                        <span className={`badge ${m.result === 'win' ? 'badge-ok' : m.result === 'loss' ? 'badge-danger' : 'badge-plain'}`}>
                          {m.result === 'win' ? 'Won' : m.result === 'loss' ? 'Lost' : 'Drew'}
                        </span>
                      </td>
                      <td className="r">
                        <span className="delta" {...deltaTone(m.ratingChange)}>{signed(m.ratingChange)}</span>
                      </td>
                      <td className="r"><Link to={`/m/${m.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export function deltaTone(n: number): Record<string, string> {
  if (n > 0) return { 'data-up': '' };
  if (n < 0) return { 'data-down': '' };
  return { 'data-flat': '' };
}

function Fact({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="fact">
      <span className="k">{k}</span>
      <span className="v num">{v}</span>
      <span className="d">{d}</span>
    </div>
  );
}

function Tile({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="card stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span className="d">{d}</span>
    </div>
  );
}
