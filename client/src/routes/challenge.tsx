import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../net/api.ts';
import { avatarSeed, modeRating, avatarVersion } from '../net/adapt.ts';
import type { Challenge as ChallengeLink } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { ShareLink } from '../ui/share-link.tsx';
import { int } from '../ui/format.ts';
import { useTitle } from '../ui/title.ts';
import { modeBlurb } from './home.tsx';

/* The other end of "play a friend": the page the link opens. Everything it
   needs is on one request, so a person who has never been here lands on a
   name, a format and one button.

   Accepting is what creates the match, and it is the server that decides
   whether the link is still worth anything: this page renders the status it
   was given and reports what came back rather than working the rules out
   again on its own. */
export function Challenge() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { me } = useSession();
  const [link, setLink] = useState<ChallengeLink | null>(null);
  const [missing, setMissing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle(link ? `Play ${link.creator.name}` : null);

  useEffect(() => {
    let live = true;
    setLink(null);
    setMissing(false);
    api
      .challenge(id)
      .then((c) => live && setLink(c))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  const accept = useCallback(async () => {
    setAccepting(true);
    setError(null);
    try {
      const { matchId } = await api.acceptChallenge(id);
      nav(`/m/${matchId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'the table could not be opened. Try the link again.');
      setAccepting(false);
      // The link may have been taken or cancelled while this page sat open,
      // so what it says next comes from the server, not from a guess.
      api.challenge(id).then(setLink).catch(() => setMissing(true));
    }
  }, [id, nav]);

  if (missing) {
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">This link does not work</h1>
          <span className="e-desc">It may be mistyped. Start a match from the home page instead.</span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </Shell>
    );
  }

  if (!link) {
    return (
      <Shell>
        <div className="searching">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Opening the challenge</span>
        </div>
      </Shell>
    );
  }

  const mine = me?.id === link.creator.id;

  if (link.status === 'expired' || link.status === 'cancelled') {
    const expired = link.status === 'expired';
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">{expired ? 'This link has expired' : 'This challenge was cancelled'}</h1>
          <span className="e-desc">
            {expired
              ? 'A challenge link works for 24 hours. Ask for a new one, or play the queue instead.'
              : `${link.creator.name} took this link back. Ask for a new one, or play the queue instead.`}
          </span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </Shell>
    );
  }

  if (link.status === 'accepted') {
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">This challenge was already taken</h1>
          <span className="e-desc">
            {mine ? 'Your link has been used.' : 'Somebody opened this link first.'}
          </span>
          <span className="tags">
            {link.matchId && (
              <Link className="btn btn-secondary btn-sm" to={`/m/${link.matchId}`}>Go to the match</Link>
            )}
            <Link className="btn btn-tertiary btn-sm" to="/">Go to the home page</Link>
          </span>
        </div>
      </Shell>
    );
  }

  if (mine) {
    return (
      <Shell>
        <div className="mode-head">
          <h1 className="t">This is your own link</h1>
        </div>
        <span className="muted">
          Send it to the friend you want to play. The match starts the moment they open it.
        </span>
        <ShareLink url={`${location.origin}/c/${link.id}`} />
        <span className="muted">Waiting for your friend. The link works for 24 hours.</span>
      </Shell>
    );
  }

  const rating = modeRating(link.creator, link.mode);

  return (
    <Shell>
      <div className="mode-head">
        <span className="player-cell">
          <Avatar
            seed={avatarSeed(link.creator.id, link.creator.name)}
            name={link.creator.name}
            avatarV={avatarVersion(link.creator.avatarV)}
          />
          <h1 className="t">{link.creator.name} wants to play you</h1>
        </span>
      </div>
      <span className="tags">
        <span className="badge badge-plain">Heads-up</span>
        <span className="badge badge-plain">{link.rated ? 'Rated' : 'Casual'}</span>
      </span>
      <span className="muted">{modeBlurb(link.mode)}</span>
      {rating.matches === 0 ? (
        <span className="muted">They have no rated heads-up matches yet.</span>
      ) : (
        <span className="tags muted">
          <span>
            Their rating <span className="num">{int(rating.rating)}</span>
            <span className="rd num">+-{int(rating.rd)}</span>
          </span>
          {rating.provisional && <span className="badge badge-warn">Provisional</span>}
        </span>
      )}
      {error && <span className="badge badge-warn">{error}</span>}
      <button type="button" className="btn btn-primary" disabled={accepting} onClick={accept}>
        Accept and play
      </button>
      <span className="muted">
        No account needed. You are dealt in as a guest and can claim the name later.
      </span>
    </Shell>
  );
}

/* The same card in every state, so the page does not jump as the challenge
   loads and the button lands where the spinner was. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page stack">
      <section className="hero">
        <div className="card mode" style={{ maxWidth: 460 }}>{children}</div>
      </section>
    </main>
  );
}
