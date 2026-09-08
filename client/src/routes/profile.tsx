import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { botLevelInfo, type Mode } from '@opentable/protocol';
import { api, ApiError } from '../net/api.ts';
import type { Profile as ProfileData } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { RatingGraph } from '../ui/rating-graph.tsx';
import { fmtDate, fmtPct, fmtShortDate, int, signed } from '../ui/format.ts';
import {
  avatarSeed, matchPlacing, matchPractice, matchRated, modePeakAt, modeRating, modeWinRate,
  profileAccuracy, ratingHistoryFor,
} from '../net/adapt.ts';
import { MODES, MODE_NAME, ModeTabs } from '../ui/mode-tabs.tsx';
import { ordinal } from '../table/labels.ts';
import { deltaTone } from '../ui/bits.tsx';
import { ClaimCard } from '../ui/auth.tsx';
import { Avatar } from '../ui/avatar.tsx';

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
  const standings = MODES.map((mode) => ({ mode, r: modeRating(data.summary, mode) }));
  const played = standings.some((s) => s.r.matches > 0) || data.lastMatches.length > 0;
  const accuracy = profileAccuracy(data);

  return (
    <main className="page wide stack">
      <header className="profile-head">
        <div className="profile-name">
          <Avatar seed={data.summary.id} name={data.summary.name} size={56} />
          <h1 className="h1">{data.summary.name}</h1>
          {data.summary.bot && data.summary.botLevel != null && (
            <span className="badge badge-plain">Bot, level {data.summary.botLevel}</span>
          )}
        </div>
        {/* A bot's rating only means something next to how it plays, so the
            level's description sits under its name rather than in a tooltip. */}
        {data.summary.bot && data.summary.botLevel != null && (
          <span className="muted">{botLevelInfo(data.summary.botLevel).description}</span>
        )}
        {/* One standing per mode: a six-max result never moves a heads-up
            rating, so a single number here would be two things at once. */}
        <div className="card lb-card">
          <div className="table-wrap">
            <table className="table" aria-label="Rating in each mode">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="r">Rating</th>
                  <th className="r">Peak</th>
                  <th className="r">Matches</th>
                  <th className="r">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {standings.map(({ mode, r }) => {
                  const winRate = modeWinRate(r);
                  const peakAt = modePeakAt(data, mode);
                  return (
                    <tr key={mode}>
                      <td>
                        <span className="tags">
                          {MODE_NAME[mode]}
                          {r.provisional && r.matches > 0 && (
                            <span className="badge badge-warn">Provisional</span>
                          )}
                        </span>
                      </td>
                      <td className="r">
                        {r.matches === 0 ? (
                          <span className="muted">unrated</span>
                        ) : (
                          <>
                            {int(r.rating)}
                            <span className="rd num">+-{int(r.rd)}</span>
                          </>
                        )}
                      </td>
                      <td className="r num">
                        {r.matches === 0 ? '' : int(r.peak)}
                        {r.matches > 0 && peakAt && <span className="rd">{fmtShortDate(peakAt)}</span>}
                      </td>
                      <td className="r num">{r.matches}</td>
                      <td className="r num">
                        {winRate == null ? '' : fmtPct(winRate * 100, 0)}
                        {r.matches > 0 && (
                          <span className="rd num">{r.wins}-{r.losses}-{r.draws}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {!played && <span className="muted">No rated matches yet.</span>}
      </header>

      {isMe && me?.guest && <ClaimCard onClaimed={load} />}

      <RatingSection profile={data} />

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
                  {data.lastMatches.map((m) => {
                    const placing = matchPlacing(m);
                    const multiway = placing != null && placing.players > 2;
                    const rated = matchRated(m);
                    const practice = matchPractice(m);
                    return (
                    <tr key={m.id}>
                      <td>{fmtDate(m.finishedAt)}</td>
                      <td>
                        {multiway && placing ? (
                          <span className="muted">{placing.players} players</span>
                        ) : (
                          <span className="player-cell">
                            <Avatar seed={avatarSeed(m.opponentId, m.opponent)} name={m.opponent} size={24} />
                            <Link to={`/u/${encodeURIComponent(m.opponent)}`}>{m.opponent}</Link>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="tags">
                          {multiway && placing ? (
                            <span className="badge badge-plain num">
                              {ordinal(placing.place)} of {placing.players}
                            </span>
                          ) : (
                            <span className={`badge ${m.result === 'win' ? 'badge-ok' : m.result === 'loss' ? 'badge-danger' : 'badge-plain'}`}>
                              {m.result === 'win' ? 'Won' : m.result === 'loss' ? 'Lost' : 'Drew'}
                            </span>
                          )}
                          {rated === false && (
                            <span className="badge badge-plain">{practice ? 'Practice' : 'Casual'}</span>
                          )}
                        </span>
                      </td>
                      <td className="r">
                        <span className="delta" {...deltaTone(m.ratingChange)}>{signed(m.ratingChange)}</span>
                      </td>
                      <td className="r"><Link to={`/m/${m.id}`}>Open</Link></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

/* The line is per mode as well: splicing a six-max result into a heads-up
   curve would draw a shape neither ladder ever had. */
function RatingSection({ profile }: { profile: ProfileData }) {
  const [mode, setMode] = useState<Mode>(() =>
    modeRating(profile.summary, 'six-max').matches > modeRating(profile.summary, 'heads-up').matches
      ? 'six-max'
      : 'heads-up',
  );
  const points = ratingHistoryFor(profile, mode);

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <span className="h2">Rating</span>
      <ModeTabs mode={mode} onPick={setMode} label="Rating history mode" />
      {points.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">No {MODE_NAME[mode].toLowerCase()} matches yet</span>
            <span className="e-desc">The line starts at the first rated match in this mode.</span>
          </div>
        </div>
      ) : (
        <RatingGraph points={points} />
      )}
    </section>
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
