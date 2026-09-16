import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BADGES, botLevelInfo, type Mode } from '@opentable/protocol';
import { api, ApiError } from '../net/api.ts';
import type {
  Insights, PositionKey, Profile as ProfileData, ProfileArena, ProfileTournament,
} from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { PageResting } from '../ui/enter.tsx';
import { RatingGraph } from '../ui/rating-graph.tsx';
import { fmtDate, fmtPct, fmtShortDate, int, signed } from '../ui/format.ts';
import {
  avatarSeed, avatarVersion, levelOf, mainMode, matchPlacing, matchPractice, matchRated, modePeakAt,
  modeRating, modeStanding, modeWinRate, profileAccuracy, profileBadges, ratingHistoryFor,
  totalMatches,
} from '../net/adapt.ts';
import { MODES, MODE_NAME, ModeTabs, modeInline } from '../ui/mode-tabs.tsx';
import { ordinal } from '../table/labels.ts';
import { deltaTone } from '../ui/bits.tsx';
import { ClaimCard } from '../ui/auth.tsx';
import { FriendAction, InviteButton, useStanding } from '../ui/friend-controls.tsx';
import { useFriends } from '../net/friends.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { EditPictureButton } from '../ui/picture-dialog.tsx';
import { Flag } from '../ui/flag.tsx';
import { CountryPicker } from '../ui/country-picker.tsx';
import { RenamePicker } from '../ui/rename-picker.tsx';
import './profile.css';

export function Profile() {
  const { name = '' } = useParams();
  const { me } = useSession();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingCountry, setEditingCountry] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
  if (!data) return <PageResting wide label="Loading the profile" />;

  const isMe = me != null && me.id === data.summary.id;
  const standings = MODES.map((mode) => ({ mode, r: modeRating(data.summary, mode) }));
  const accuracy = profileAccuracy(data);
  const flag = isMe ? (me?.country ?? null) : (data.summary.country ?? null);
  const headMode = mainMode(data);
  const headRating = modeRating(data.summary, headMode);

  return (
    <main className="page wide stack">
      <header className="profile-head">
        <div className="profile-name">
          <Avatar
            seed={data.summary.id}
            name={data.summary.name}
            size={56}
            /* The higher of the two, which is always the newer: a version only
               ever goes up, and uploading refreshes the session while this
               page's copy stays as it was fetched. Re-fetching the profile to
               move one number would blank the page. */
            avatarV={Math.max(
              avatarVersion(data.summary.avatarV),
              isMe ? avatarVersion(me?.avatarV) : 0
            )}
          />
          {/* Your own flag comes from the session rather than from the payload
              this page loaded with: the picker below changes the session, and
              a heading that waited for a refetch would go on showing the flag
              you had just replaced. */}
          {flag && <Flag code={flag} size={24} />}
          <h1 className="h1">{data.summary.name}</h1>
          {/* The rating reads beside the name, the way the home page's own
              player row does: the mode this player actually plays, so the
              number here is never a mode they have not touched. The fuller
              picture (peak, standing) is still the card below. */}
          {headRating.matches > 0 && (
            <span className="profile-rating num">{int(headRating.rating)}</span>
          )}
          <span className="muted">{MODE_NAME[headMode]}</span>
          {/* Level is how much poker has been played on this account and
              nothing else. It sits beside the name because that is what it
              describes; the rating, which is the skill claim, is the number
              in the card below. Somebody who has finished nothing has no
              level rather than a level nought. */}
          {!data.summary.bot && levelOf(data.summary) > 0 && (
            <span className="badge badge-plain" title={`${totalMatches(data.summary)} matches finished`}>
              Level {levelOf(data.summary)}
            </span>
          )}
          {data.summary.bot && data.summary.botLevel != null && (
            <span className="badge badge-plain">Bot, level {data.summary.botLevel}</span>
          )}
          {/* Beside your own avatar, because that is the thing it changes. It
              is the same dialog the settings menu opens. */}
          {isMe && <EditPictureButton />}
          {isMe && (
            <button
              type="button"
              className="btn btn-tertiary btn-sm"
              aria-expanded={renaming}
              onClick={() => setRenaming((v) => !v)}
            >
              {renaming ? 'Close' : 'Rename'}
            </button>
          )}
          {isMe && (
            <button
              type="button"
              className="btn btn-tertiary btn-sm"
              aria-expanded={editingCountry}
              onClick={() => setEditingCountry((v) => !v)}
            >
              {editingCountry ? 'Close' : 'Edit country'}
            </button>
          )}
          {/* Somebody else's page, and somebody who can be a friend: not you,
              not a bot, and not a guest whose name will be handed out again.
              The control says where you already stand rather than offering an
              Add that answers "you asked yesterday". */}
          {!isMe && !data.summary.bot && !data.summary.guest && (
            <FriendActions userId={data.summary.id} name={data.summary.name} />
          )}
        </div>
        {/* The same control the settings menu offers, mounted here because a
            profile is where somebody looks at their own name. */}
        {isMe && renaming && <RenamePicker onSaved={() => setRenaming(false)} />}
        {isMe && editingCountry && (
          <CountryPicker label="Country" onSaved={() => setEditingCountry(false)} />
        )}
        {/* A bot's rating only means something next to how it plays, so the
            level's description sits under its name rather than in a tooltip. */}
        {data.summary.bot && data.summary.botLevel != null && (
          <span className="muted">{botLevelInfo(data.summary.botLevel).description}</span>
        )}
      </header>

      <RatingSection profile={data} />

      <Badges profile={data} />

      {/* One standing per mode: a six-max result never moves a heads-up
          rating, so a single number here would be two things at once. The
          headline above is one of these rows blown up; this is the rest. */}
      <section className="stack" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Every mode</span>
        <div className="card lb-card">
          <div className="table-wrap">
            <table className="table" aria-label="Rating in each mode">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="r">Rating</th>
                  <th className="r">Peak</th>
                  <th className="r">Percentile</th>
                  <th className="r">Matches</th>
                  <th className="r">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {standings.map(({ mode, r }) => {
                  const winRate = modeWinRate(r);
                  const peakAt = modePeakAt(data, mode);
                  const standing = modeStanding(data, mode);
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
                          <span className="muted">Unrated</span>
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
                      <td className="r">
                        {standing == null ? (
                          ''
                        ) : (
                          <>
                            <span className="num">Top {topShare(standing.percentile)}</span>
                            <span className="rd num">{standing.rank} of {standing.population}</span>
                          </>
                        )}
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
      </section>

      {isMe && me?.guest && <ClaimCard onClaimed={load} />}

      {/* How the site looks is one panel the shell places, and this is the second
          place to reach it: the profile is where somebody goes to change things
          about themselves. It opens that panel rather than repeating its
          controls, so there is one place a setting can be wrong. */}
      {isMe && (
        <section className="stack" style={{ gap: 'var(--sp-3)' }}>
          <span className="h2">Appearance</span>
          <div className="card appearance">
            <span className="muted">Theme, palette, accent and the deck, all in one panel.</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              popoverTarget="settings-menu"
              aria-haspopup="dialog"
            >
              Open appearance settings
            </button>
          </div>
        </section>
      )}

      <InsightsSection profile={data} />

      {/* Accuracy and not a style block: VPIP, PFR, aggression and fold to
          three-bet used to be printed here as well, over the player's whole
          history, and they are in Insights above per mode. The same four
          labels carrying two different numbers on one page is worse than one
          of them, so this section keeps only the score that Insights does not
          derive. It is a heads-up number because the baseline charts are
          heads-up: `hands.study` is null for a six-max hand. */}
      <section className="stack" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Preflop accuracy</span>
        {accuracy != null ? (
          <>
            <div className="tiles tiles-one">
              <Tile k="Accuracy" v={fmtPct(accuracy)} d="Against the baseline charts" />
            </div>
            <span className="muted">
              Over {data.stats.hands} hands. 6X hands are not scored: the charts are heads-up.
            </span>
          </>
        ) : (
          <div className="card">
            <div className="empty">
              <span className="e-title">Nothing scored yet</span>
              <span className="e-desc">
                Preflop decisions are scored against the baseline charts, which are heads-up only.
                The number starts at the first heads-up hand.
              </span>
            </div>
          </div>
        )}
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
                            <Avatar
                              seed={avatarSeed(m.opponentId, m.opponent)}
                              name={m.opponent}
                              size={24}
                              avatarV={avatarVersion(m.opponentAvatarV)}
                            />
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
                        {rated === false ? (
                          <span className="muted">Unrated</span>
                        ) : (
                          <span className="delta" {...deltaTone(m.ratingChange)}>{signed(m.ratingChange)}</span>
                        )}
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

      <ArenasSection arenas={data.arenas ?? []} />

      <TournamentsSection
        tournaments={data.tournaments ?? []}
        record={data.tournamentRecord ?? { wins: 0, podiums: 0 }}
      />
    </main>
  );
}

/* Arenas this player has finished. Absent on a server from before arenas
   existed and empty for somebody who has never entered one, and both read as
   no section at all rather than as an empty table with a heading over it. */
function ArenasSection({ arenas }: { arenas: ProfileArena[] }) {
  if (arenas.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <span className="h2">Arenas</span>
      <div className="card lb-card">
        <div className="table-wrap">
          <table className="table" aria-label="Arenas">
            <thead>
              <tr>
                <th>Date</th>
                <th>Arena</th>
                <th className="r">Place</th>
                <th className="r">Score</th>
                <th className="r">Board</th>
              </tr>
            </thead>
            <tbody>
              {arenas.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.endsAt)}</td>
                  <td>{a.name}</td>
                  <td className="r">
                    {a.place === null ? (
                      <span className="muted">Unplaced</span>
                    ) : (
                      <span className="badge badge-plain num">
                        {ordinal(a.place)} of {a.players}
                      </span>
                    )}
                  </td>
                  <td className="r num">{a.score}</td>
                  <td className="r"><Link to={`/arena/${a.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* Tournaments this player has been in. Absent on a server from before
   tournaments existed and empty for somebody who has never entered one, and
   both read as no section at all rather than as an empty table.

   The career record is two badges in this heading rather than a line in the
   rating card above it. That card is one mode at a time and reserves its box
   at its widest so picking the other mode moves nothing under it; a count of
   tournaments won belongs to neither mode and would have to sit in a slot the
   card keeps empty half the time. */
function TournamentsSection({
  tournaments,
  record,
}: {
  tournaments: ProfileTournament[];
  record: { wins: number; podiums: number };
}) {
  if (tournaments.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div className="tourney-record">
        <span className="h2">Tournaments</span>
        <span className="tags">
          {record.wins > 0 && (
            <span className="badge badge-plain num">
              {record.wins} {record.wins === 1 ? 'win' : 'wins'}
            </span>
          )}
          {record.podiums > 0 && (
            <span className="badge badge-plain num">
              {record.podiums} {record.podiums === 1 ? 'podium' : 'podiums'}
            </span>
          )}
        </span>
      </div>
      <div className="card lb-card">
        <div className="table-wrap">
          <table className="table" aria-label="Tournaments">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tournament</th>
                <th className="r">Place</th>
                <th className="r">Field</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.startsAt)}</td>
                  <td><Link to={`/t/${t.id}`}>{t.name}</Link></td>
                  <td className="r">
                    {t.status === 'cancelled' ? (
                      <span className="muted">Not played</span>
                    ) : t.place === null ? (
                      <span className="muted">Unplaced</span>
                    ) : (
                      <span className="badge badge-plain num">{ordinal(t.place)}</span>
                    )}
                  </td>
                  <td className="r num">{t.players}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* The headline and the line under it, one mode at a time. They share the mode
   the tabs pick rather than keeping one each, so the big number and the curve
   below it are never two different modes at once. It opens on the mode this
   player actually plays, which is what the number is for: their rating where
   they play, not the higher of two. */
function RatingSection({ profile }: { profile: ProfileData }) {
  const [mode, setMode] = useState<Mode>(() => mainMode(profile));
  const points = ratingHistoryFor(profile, mode);

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <HeroRating profile={profile} mode={mode} />
      <ModeTabs mode={mode} onPick={setMode} label="Rating history mode" />
      {points.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">No {modeInline(mode)} matches yet</span>
            <span className="e-desc">The line starts at the first rated match in this mode.</span>
          </div>
        </div>
      ) : (
        <RatingGraph points={points} />
      )}
    </section>
  );
}

/* The one number this page is for. The rating is the largest thing on the
   screen, the peak sits under it, and beside them is the only part of a rating
   anybody can read without knowing the scale: where it puts you among everyone
   else who plays this mode.

   The card holds its height across both states and every field is reserved at
   its widest, so picking the other mode moves nothing on the page under it. */
function HeroRating({ profile, mode }: { profile: ProfileData; mode: Mode }) {
  const r = modeRating(profile.summary, mode);
  const standing = modeStanding(profile, mode);
  const modeName = modeInline(mode);

  if (r.matches === 0) {
    return (
      <div className="card rating-hero">
        <div className="rating-hero-main">
          <span className="k">{MODE_NAME[mode]}</span>
          <span className="v" data-empty="">Unrated</span>
          <span className="d">No rated {modeName} matches yet.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card rating-hero">
      <div className="rating-hero-main">
        <span className="k">{MODE_NAME[mode]}</span>
        <span className="v num">{int(r.rating)}</span>
        <span className="d">
          Peak <span className="num">{int(r.peak)}</span>
        </span>
      </div>
      {/* A field of one is not a field: nobody is above or below you, so
          there is no share to print and the card shows the rating alone. */}
      {standing != null && standing.population > 1 && (
        <div className="rating-hero-place">
          <span className="rating-hero-share">
            Top {topShare(standing.percentile)} of {modeName} players
          </span>
          {/* g's progress bar, filled to the share of the field this player is
              above, so a fuller bar is a better standing. The numbers are both
              in the text either side of it, which is why it is not read out a
              third time. */}
          <span
            className="g-progress"
            role="progressbar"
            aria-hidden="true"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={standing.percentile}
          >
            <span className="g-progress-fill" style={{ width: `${standing.percentile}%` }} />
          </span>
          <span className="rating-hero-rank num">
            Rank {standing.rank} of {standing.population}
          </span>
        </div>
      )}
    </div>
  );
}

/* What this player has done, as the six things worth marking. Derived from
   counters already on this page rather than awarded into a table, so there is
   nothing to write when one is earned and nothing that can be out of date.
   They unlock nothing: a badge here is a record, not a key.

   A player with none of them gets no section at all rather than a row of
   greyed-out promises, and a bot gets none either, since none of this is
   about a bot. The unearned ones are drawn beside the earned ones, dimmed,
   so the set reads as a set and there is something to play toward. */
function Badges({ profile }: { profile: ProfileData }) {
  if (profile.summary.bot) return null;
  const earned = new Set(profileBadges(profile));
  if (earned.size === 0) return null;

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <span className="h2">Badges</span>
      <div className="card badge-set">
        {BADGES.map((b) => (
          <span
            className="badge badge-plain profile-badge"
            key={b.id}
            data-earned={earned.has(b.id) ? '' : undefined}
            title={b.description}
          >
            {b.name}
          </span>
        ))}
      </div>
    </section>
  );
}

/* "Top 12%": the share of the field above this player, which is the other side
   of the percentile the server sends. Anything under one percent keeps a
   decimal, because the best of two hundred and eighty is top 0.4% and rounding
   that to zero would say nothing at all. */
function topShare(percentile: number): string {
  const above = 100 - percentile;
  return above > 0 && above < 1 ? `${above.toFixed(1)}%` : `${Math.round(above)}%`;
}

const POSITION_NAME: Record<PositionKey, string> = {
  button: 'Button',
  'small-blind': 'Small blind',
  'big-blind': 'Big blind',
  utg: 'Under the gun',
  hijack: 'Hijack',
  cutoff: 'Cutoff',
};

const STREET_ORDER: { key: keyof NonNullable<Insights['streets']>; label: string }[] = [
  { key: 'preflop', label: 'Preflop' },
  { key: 'flop', label: 'Flop' },
  { key: 'turn', label: 'Turn' },
  { key: 'river', label: 'River' },
  { key: 'showdown', label: 'Showdown' },
];

/* Its own request, made when the section mounts and again when the mode
   changes: the profile payload is a page load and this is derived from every
   hand the player has ever played, so it is not something to make everybody
   wait for. The server caches it per player and mode. */
function InsightsSection({ profile }: { profile: ProfileData }) {
  const name = profile.summary.name;
  const [mode, setMode] = useState<Mode>(() => mainMode(profile));
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .insights(name, mode)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [name, mode]);

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <span className="h2">Insights</span>
      <p className="muted">
        How this player plays, read back out of their hands in this mode rather than counted as they
        went along.
      </p>
      <ModeTabs mode={mode} onPick={setMode} label="Insights mode" />
      <InsightsBody data={data} error={error} mode={mode} />
    </section>
  );
}

function InsightsBody({ data, error, mode }: { data: Insights | null; error: string | null; mode: Mode }) {
  if (error) {
    return (
      <div className="card">
        <div className="empty">
          <span className="e-title">The insights did not load</span>
          <span className="e-desc">{error}. Reload to try again.</span>
        </div>
      </div>
    );
  }
  if (!data) return <span className="muted">Loading</span>;

  const { sample, preflop, postflop, positions, streets, results } = data;
  if (!preflop || !postflop || !positions || !streets || !results) {
    return (
      <div className="card">
        <div className="empty">
          <span className="e-title">Insights appear after {data.minHands} hands in this mode</span>
          <span className="e-desc">
            {sample.hands === 0
              ? `No ${modeInline(mode)} hands played yet.`
              : `${sample.hands} of ${data.minHands} so far.`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ins-group">
        <span className="muted">Preflop</span>
        <div className="tiles">
          <Rate k="VPIP" v={preflop.vpip} d="Hands played voluntarily" empty="No hands" />
          <Rate k="PFR" v={preflop.pfr} d="Hands raised preflop" empty="No hands" />
          <Rate k="3bet" v={preflop.threeBet} d="Raises over someone else's open" empty="No opens faced" />
          <Rate
            k="Fold to 3bet"
            v={preflop.foldToThreeBet}
            d="Folds when reraised preflop"
            empty="No 3bets faced"
          />
        </div>
      </div>

      <div className="ins-group">
        <span className="muted">Postflop</span>
        <div className="tiles">
          <Rate
            k="Aggression"
            v={postflop.aggressionFactor}
            d="Bets and raises per call after the flop"
            empty="No calls yet"
            unit="x"
          />
          <Rate k="C-bet" v={postflop.cbet} d="Flops bet after raising preflop" empty="No chances yet" />
          <Rate
            k="To showdown"
            v={postflop.wentToShowdown}
            d="Flops seen that reach a showdown"
            empty="No flops seen"
          />
          <Rate
            k="Won at showdown"
            v={postflop.wonAtShowdown}
            d="Showdowns that finish ahead"
            empty="No showdowns"
          />
          <Rate
            k="Won without"
            v={postflop.wonWithoutShowdown}
            d="Pots won that ended before a showdown"
            empty="No pots won"
          />
        </div>
      </div>

      <div className="ins-group">
        <span className="muted">Net big blinds a hand, by seat</span>
        <div className="card">
          <PositionBars positions={positions} />
        </div>
      </div>

      <div className="ins-group">
        <span className="muted">Where hands end</span>
        <div className="card">
          <StreetBar streets={streets} />
        </div>
      </div>

      <div className="ins-group">
        <span className="muted">Results</span>
        <div className="card ins-results">
          <dl className="kv">
            <dt>Biggest pot won</dt>
            <dd>
              {results.biggestPot ? (
                <Link to={`/m/${results.biggestPot.matchId}/h/${results.biggestPot.handNumber}`}>
                  {results.biggestPot.chips} chips
                  <span className="u">{results.biggestPot.bb} bb</span>
                </Link>
              ) : (
                'None yet'
              )}
            </dd>
            <dt>Longest run of wins</dt>
            <dd>
              {results.longestWinStreak}
              <span className="u">{results.longestWinStreak === 1 ? 'match' : 'matches'}</span>
            </dd>
            <dt>Average hand</dt>
            <dd>{results.averageHandMs == null ? 'Not timed' : fmtDuration(results.averageHandMs)}</dd>
            <dt>Actions the clock took</dt>
            <dd>{results.timeouts}</dd>
          </dl>
        </div>
      </div>

      <span className="muted">
        Over {sample.hands} hands in {sample.matches} {sample.matches === 1 ? 'match' : 'matches'}.
      </span>
    </>
  );
}

/* Bars measured from a centre line, longest one filling half the track, so
   the seats that pay for the rest are the shape of the block rather than a
   column of signs to read. A seat never played keeps its row and says
   nothing, which is the honest thing for a six-max table somebody has only
   sat at four seats of. */
function PositionBars({ positions }: { positions: NonNullable<Insights['positions']> }) {
  const peak = Math.max(...positions.map((p) => Math.abs(p.bbPerHand ?? 0)), 0.01);

  return (
    <div className="ins-bars">
      {positions.map((p) => {
        const v = p.bbPerHand;
        const share = v === null ? 0 : (Math.abs(v) / peak) * 50;
        const down = v !== null && v < 0;
        return (
          <div className="ins-bar" key={p.key} data-idle={p.hands === 0 ? '' : undefined}>
            <span className="lab">{POSITION_NAME[p.key]}</span>
            <span
              className="track"
              role="img"
              aria-label={
                v === null
                  ? `${POSITION_NAME[p.key]}, not played`
                  : `${POSITION_NAME[p.key]}, ${signedBb(v)} big blinds a hand over ${p.hands} hands`
              }
            >
              <span className="zero" />
              {v !== null && (
                <span
                  className="fill"
                  data-sign={down ? 'down' : 'up'}
                  style={{ left: `${down ? 50 - share : 50}%`, width: `${share}%` }}
                />
              )}
            </span>
            <span className="val num">
              {v === null ? '' : signedBb(v)}
              <span className="n">{p.hands}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StreetBar({ streets }: { streets: NonNullable<Insights['streets']> }) {
  const rows = STREET_ORDER.map((s) => ({ ...s, pct: streets[s.key] }));
  return (
    <div className="ins-street">
      <div
        className="track"
        role="img"
        aria-label={rows.map((r) => `${r.label} ${fmtPct(r.pct, 0)}`).join(', ')}
      >
        {rows.map((r) =>
          r.pct > 0 ? (
            <span
              key={r.key}
              className="seg"
              data-street={r.key}
              style={{ width: `${r.pct}%` }}
              title={`${r.label} ${fmtPct(r.pct)}`}
            />
          ) : null
        )}
      </div>
      <div className="ins-legend">
        {rows.map((r) => (
          <span className="item" key={r.key}>
            <span className="dot" data-street={r.key} />
            {r.label}
            <span className="n">{fmtPct(r.pct, 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* A rate with no denominator is not zero, so the tile says which chance never
   came up rather than printing a number nobody earned. */
function Rate({
  k,
  v,
  d,
  empty,
  unit = '%',
}: {
  k: string;
  v: number | null;
  d: string;
  empty: string;
  unit?: '%' | 'x';
}) {
  return (
    <div className="card stat">
      <span className="k">{k}</span>
      {v === null ? (
        <span className="v" data-empty="">{empty}</span>
      ) : (
        <span className="v">{unit === '%' ? fmtPct(v) : v.toFixed(2)}</span>
      )}
      <span className="d">{d}</span>
    </div>
  );
}

function signedBb(n: number): string {
  if (n === 0) return '0.00';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
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

/* The friend controls on somebody else's profile, and the one thing this page
   can offer that a row cannot: a challenge while they are actually here.
   Offered only to a friend who is online and not already at a table, because
   a button that deals a link to somebody who left an hour ago is a link
   nobody answers. */
function FriendActions({ userId, name }: { userId: string; name: string }) {
  const standing = useStanding(userId);
  const { data } = useFriends();
  const friend = data?.friends.find((f) => f.id === userId) ?? null;
  const challengeable = standing === 'friends' && friend?.online === true && friend.playing == null;

  return (
    <>
      <FriendAction userId={userId} name={name} />
      {challengeable && <InviteButton userId={userId} label="Challenge" />}
    </>
  );
}
