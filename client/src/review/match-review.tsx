import { useEffect, useState } from 'react';
import { api } from '../net/api.ts';
import type { MatchReview as MatchReviewData, MatchSeatReview } from '../net/types.ts';
import { PlayerCard } from './player-card.tsx';

/* The match-level review, under the result and the hand list on /m/:id.
   Its own request, the way the profile's insights are: a finished match's
   review is cacheable on the server (server/src/routes.ts), so it costs
   nothing to fetch only when this section is actually on screen, and nothing
   for a match nobody scrolls this far into.

   Why this exists beside `insights.ts`'s career numbers, and how it answers
   the sample-size problem a single sitting always has, is
   client/src/review/CLAUDE.md. */
export function MatchReview({ matchId, meId }: { matchId: string; meId: string | null }) {
  const [data, setData] = useState<MatchReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .matchReview(matchId)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [matchId]);

  if (error) {
    return (
      <section className="stack review-section" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Match review</span>
        <div className="card">
          <div className="empty">
            <span className="e-title">The review did not load</span>
            <span className="e-desc">{error}. Reload to try again.</span>
          </div>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="stack review-section" style={{ gap: 'var(--sp-3)' }}>
        <span className="h2">Match review</span>
        <span className="muted">Loading</span>
      </section>
    );
  }

  const studied = data.seats.some((s) => s.accuracy !== null);
  const shortSample = data.hands < data.minHands;
  const you = data.seats.find((s) => s.userId === meId) ?? null;
  // One scale for every seat's chip sparkline, not one per card: a seat that
  // only ever held 200 units has to draw shorter than one that ran to 800,
  // or the small multiples would each be comparing a different scale as if
  // they were the same chart.
  const maxChips = Math.max(1, ...data.seats.flatMap((s) => s.chips.map((p) => p.chips)));

  return (
    <section className="stack review-section" style={{ gap: 'var(--sp-4)' }}>
      <header className="review-head">
        <span className="h2">Match review</span>
        <p className="muted">
          How everybody at this table actually played, over its {data.hands}{' '}
          {data.hands === 1 ? 'hand' : 'hands'}
          {shortSample
            ? `. That is short of the ${data.minHands} hands a rate needs to mean anything, so every
               card below backs its numbers with counts rather than rates you cannot trust.`
            : '.'}
        </p>
      </header>

      <AccuracyBanner data={data} />

      <div className="review-grid">
        {orderSeats(data.seats, meId).map((s) => (
          <PlayerCard key={s.userId} seat={s} you={s.userId === meId} studied={studied} maxChips={maxChips} />
        ))}
      </div>

      {you == null && meId != null && (
        <span className="muted">You were not seated at this match.</span>
      )}
    </section>
  );
}

/* Your own seat first, everybody else by finishing place. A spectator's page
   has no "you" to promote, which is the ordinary place order already. */
function orderSeats(seats: MatchSeatReview[], meId: string | null): MatchSeatReview[] {
  return [...seats].sort((a, b) => {
    if (a.userId === meId) return -1;
    if (b.userId === meId) return 1;
    const pa = a.place ?? 99;
    const pb = b.place ?? 99;
    return pa - pb;
  });
}

/* The point of the feature, stated the moment the numbers support it: the
   most accurate preflop player at the table and whether they actually won.
   Silent wherever the comparison cannot be made honestly — under two graded
   seats, or a six-max match with no study at all. */
function AccuracyBanner({ data }: { data: MatchReviewData }) {
  const graded = data.seats.filter((s) => s.accuracy && s.accuracy.hands > 0);
  if (graded.length < 2) return null;
  const best = graded.reduce((a, b) => ((b.accuracy?.mean ?? 0) > (a.accuracy?.mean ?? 0) ? b : a));
  if (best.result === 'win') return null;
  const winner = data.seats.find((s) => s.result === 'win');
  return (
    <div className="card review-banner">
      <div className="empty">
        <span className="e-title">The most accurate player didn't win</span>
        <span className="e-desc">
          {best.name} played the most accurate preflop of anybody here ({(best.accuracy?.mean ?? 0).toFixed(0)}
          {' '}over {best.accuracy?.hands} graded {best.accuracy?.hands === 1 ? 'hand' : 'hands'}), but{' '}
          {winner ? winner.name : 'somebody else'} took the match. Accuracy is a preflop read, not a scoreboard.
        </span>
      </div>
    </div>
  );
}
