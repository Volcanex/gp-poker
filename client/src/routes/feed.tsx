import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../net/api.ts';
import type { FeedMatch, FeedPlayer, SiteStats } from '../net/types.ts';
import { MODE_NAME } from '../ui/mode-tabs.tsx';
import { deltaTone } from '../ui/bits.tsx';
import { fmtShortDate, signed } from '../ui/format.ts';
import './home.css';

/* The live counts and the finished matches under the mode cards. The watch
   page renders the same row, so the row and the clock beside it live here
   rather than inside the home page. */

const STATS_EVERY_MS = 10_000;
const HOME_ROWS = 8;

/* Relative until a week has passed, then the date. A feed row is read for
   "how long ago", and "6 Sep" answers that better than "213h ago". */
export function ago(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtShortDate(iso);
}

/* Arena, home game, practice, rated or casual: one badge, because a match is
   exactly one of the five and two badges would read as though it could be
   both. An arena match and a home game are both named ahead of their stake,
   because the event is the thing somebody would look for it by. */
export function StakeBadge({
  rated,
  practice,
  homeGame,
  arena,
}: {
  rated: boolean;
  practice: boolean;
  homeGame?: boolean;
  arena?: string | null;
}) {
  if (arena) return <span className="badge badge-plain">Arena</span>;
  if (homeGame) return <span className="badge badge-plain">Home game</span>;
  if (practice) return <span className="badge badge-plain">Practice</span>;
  return <span className="badge badge-plain">{rated ? 'Rated' : 'Casual'}</span>;
}

export function StatsStrip() {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      api
        .stats()
        .then((s) => live && setStats(s))
        .catch(() => {
          /* a poll that missed is not worth a message on the home page */
        });
    };
    load();
    const id = setInterval(load, STATS_EVERY_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  /* The strip keeps its height while it is empty, so the page under it does
     not jump when the first poll lands. */
  if (!stats) return <div className="stats-strip" aria-hidden="true" />;

  /* A count that did not arrive as a number is dropped rather than printed as
     a bare label: an older server missing a field should read as less
     information, not as a broken line. */
  const counts = [
    { n: stats.online, label: 'online' },
    ...(stats.inQueue > 0 ? [{ n: stats.inQueue, label: 'searching' }] : []),
    { n: stats.playing, label: 'playing' },
    { n: stats.matchesToday, label: stats.matchesToday === 1 ? 'match today' : 'matches today' },
  ].filter((c) => Number.isFinite(c.n));

  if (counts.length === 0) return <div className="stats-strip" aria-hidden="true" />;

  return (
    <div className="stats-strip" role="status">
      {counts.map((c, i) => (
        <Fragment key={c.label}>
          {i > 0 && (
            <span className="sep" aria-hidden="true">
              &middot;
            </span>
          )}
          <span>
            <b>{c.n}</b> {c.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function PlayerName({ player, showDelta, comma }: { player: FeedPlayer; showDelta: boolean; comma: boolean }) {
  const change =
    player.ratingBefore !== null && player.ratingAfter !== null ? player.ratingAfter - player.ratingBefore : null;
  return (
    <span className="name">
      <Link to={`/u/${encodeURIComponent(player.name)}`}>{player.name}</Link>
      {player.bot && <span className="bot-tag">bot</span>}
      {showDelta && change !== null && (
        <span className="delta" {...deltaTone(change)}>
          {signed(change)}
        </span>
      )}
      {comma && (
        <span className="punct" aria-hidden="true">
          ,
        </span>
      )}
    </span>
  );
}

/* Names are in finishing order, so heads-up reads as a sentence and a
   six-max table reads as a result sheet. */
export function MatchRow({ match }: { match: FeedMatch }) {
  const { players } = match;
  const headsUp = players.length === 2;
  return (
    <div className="feed-row">
      <Link className="row-link" to={`/m/${match.id}`} aria-label={`Match ${match.id}`} />
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
        {players.map((p, i) => (
          <Fragment key={`${p.name}-${i}`}>
            {headsUp && i === 1 && <span className="beat">beat</span>}
            <PlayerName player={p} showDelta={match.rated} comma={!headsUp && i < players.length - 1} />
          </Fragment>
        ))}
      </span>
      <span className="feed-meta">
        <span>
          {match.handsPlayed} {match.handsPlayed === 1 ? 'hand' : 'hands'}
        </span>
        <span>{ago(match.finishedAt)}</span>
      </span>
    </div>
  );
}

function RowSkeletons() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div className="feed-row" key={i}>
          <span className="skeleton skeleton-text" style={{ width: 72 }} />
          <span className="skeleton skeleton-text" style={{ width: 140 }} />
        </div>
      ))}
    </>
  );
}

export function RecentMatches({ limit = HOME_ROWS }: { limit?: number }) {
  const [list, setList] = useState<FeedMatch[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .recent(limit)
      .then((rows) => live && setList(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [limit]);

  const empty = failed || (list !== null && list.length === 0);

  return (
    <section className="stack" id="recent" style={{ gap: 'var(--sp-3)' }} data-enter-ready={list ? 'yes' : 'no'}>
      <div className="feed-head">
        <span className="h2">Recent matches</span>
        <span className="muted">Every match has a permanent page</span>
        <span className="spacer" />
        <Link className="btn btn-tertiary btn-sm" to="/watch">
          Watch a live table
        </Link>
      </div>
      <div className="card feed-card">
        {empty ? (
          <div className="empty">
            <span className="e-title">{failed ? 'The feed did not load' : 'No matches yet'}</span>
            <span className="e-desc">
              {failed
                ? 'Reload to try again.'
                : 'The feed fills in as matches finish. Start one from the cards above.'}
            </span>
          </div>
        ) : list === null ? (
          <RowSkeletons />
        ) : (
          list.map((m) => <MatchRow key={m.id} match={m} />)
        )}
      </div>
    </section>
  );
}
