import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { replay } from '@opentable/engine';
import type { HandConfig, HandState } from '@opentable/engine';
import { api, ApiError } from '../net/api.ts';
import type { Hand, Match, SeatStudy } from '../net/types.ts';
import { useTitle } from '../ui/title.ts';
import { isTextEntry } from '../ui/bits.tsx';
import { Table } from '../table/table.tsx';
import { actionText, streetText } from '../table/labels.ts';
import { stateToView } from '../replay/to-view.ts';
import { verifyHand } from '../replay/fairness.ts';
import type { Check } from '../replay/fairness.ts';
import { BoardText } from '../ui/board-text.tsx';

export function Replay() {
  const { id = '', n = '1' } = useParams();
  const number = Number(n) || 1;
  const [hand, setHand] = useState<Hand | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTitle(`Hand ${number}, match ${id}`);

  useEffect(() => {
    let live = true;
    setHand(null);
    setError(null);
    api
      .hand(id, number)
      .then((h) => live && setHand(h))
      .catch((e: Error) => live && setError(e instanceof ApiError && e.status === 404 ? 'notfound' : e.message));
    /* Only for the hand count either side of this one; the replay itself needs
       nothing from the match row, so a failure here is not an error state. */
    api
      .match(id)
      .then((m) => live && setMatch(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, number]);

  if (error) {
    return (
      <main className="page">
        <div className="card">
          <div className="empty">
            <span className="e-title">{error === 'notfound' ? 'No such hand' : 'The hand did not load'}</span>
            <span className="e-desc">
              {error === 'notfound'
                ? `Match ${id} has no hand ${number}.`
                : `${error}. Reload to try again.`}
            </span>
            <Link className="btn btn-secondary btn-sm" to={`/m/${id}`}>Back to the match</Link>
          </div>
        </div>
      </main>
    );
  }
  if (!hand) {
    return (
      <main className="page">
        <span className="muted">Loading</span>
      </main>
    );
  }
  return <HandReplay hand={hand} handCount={match?.hands.length ?? null} />;
}

function HandReplay({ hand, handCount }: { hand: Hand; handCount: number | null }) {
  const [step, setStep] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const states = useMemo<HandState[] | null>(() => {
    if (!hand.seed) return null;
    const config: HandConfig = {
      seats: hand.seats.map((s, i) => ({ id: s.userId, stack: hand.stacksStart[i] ?? 0 })),
      button: hand.button,
      sb: hand.sb,
      bb: hand.bb,
      seed: hand.seed,
    };
    try {
      return replay(config, hand.actions);
    } catch {
      return null;
    }
  }, [hand]);

  const total = states?.length ?? 0;
  const clampStep = useCallback((v: number) => Math.max(0, Math.min(total - 1, v)), [total]);

  useEffect(() => {
    if (!states) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStep((v) => Math.max(0, v - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setStep((v) => Math.min(total - 1, v + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [states, total]);

  const view = states ? stateToView(hand, states[clampStep(step)], clampStep(step), showAll) : null;

  return (
    <main className="page wide stack">
      <header className="replay-head">
        <div>
          <h1 className="h1">Hand {hand.number}{handCount ? ` of ${handCount}` : ''}</h1>
          <span className="muted">
            Match <Link to={`/m/${hand.matchId}`}>{hand.matchId}</Link>
            {hand.completedAt ? '' : ' · still being played'}
          </span>
        </div>
        <div className="replay-links">
          {hand.number > 1 && (
            <Link className="btn btn-tertiary btn-sm" to={`/m/${hand.matchId}/h/${hand.number - 1}`}>
              Previous hand
            </Link>
          )}
          {(handCount == null || hand.number < handCount) && (
            <Link className="btn btn-tertiary btn-sm" to={`/m/${hand.matchId}/h/${hand.number + 1}`}>
              Next hand
            </Link>
          )}
        </div>
      </header>

      {!states || !view ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">{hand.seed ? 'This hand could not be replayed' : 'The seed is not published yet'}</span>
            <span className="e-desc">
              {hand.seed
                ? 'The recorded actions do not replay against the recorded seed. That is a bug worth reporting.'
                : 'The seed is published the moment the hand ends, and the replay works from that point on.'}
            </span>
          </div>
        </div>
      ) : (
        <div className="replay">
          <div className="replay-main">
            <div className="card replay-felt">
              <Table view={view} onAct={() => {}} sending={false} bare />
            </div>
            <div className="scrubber">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={step === 0}
                onClick={() => setStep((v) => Math.max(0, v - 1))}
              >
                Previous
              </button>
              <span className="counter num">{clampStep(step) + 1} of {total}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={step >= total - 1}
                onClick={() => setStep((v) => Math.min(total - 1, v + 1))}
              >
                Next
              </button>
              <span className="scrub-hint">
                <span className="kbd">left</span><span className="kbd">right</span> step
              </span>
              <span className="spacer" />
              <label className="switch-row">
                <span className="label">Show all cards</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  aria-label="Show all cards"
                />
              </label>
            </div>
          </div>

          <ActionList hand={hand} states={states} step={clampStep(step)} onPick={setStep} />
        </div>
      )}

      <Fairness hand={hand} />
    </main>
  );
}

/* Pairs each of a seat's preflop actions with that seat's scored decisions, in
   order. This is sound because the scorer walks the same actions in the same
   order and only ever drops decisions off the end (a spot stops being a named
   spot once the raises stack up past a 3bet), never from the middle. Actions
   past the last scored decision simply carry no verdict. */
function studyFor(hand: Hand, states: HandState[], index: number): string | null {
  const action = hand.actions[index];
  if (!action || states[index]?.street !== 'pre') return null;
  const study: SeatStudy | undefined = hand.study?.[action.s];
  if (!study?.decisions?.length) return null;

  let seen = 0;
  for (let i = 0; i < index; i += 1) {
    const a = hand.actions[i];
    if (a && a.s === action.s && states[i]?.street === 'pre') seen += 1;
  }
  const decision = study.decisions[seen];
  if (!decision) return null;

  const best = { aggr: 'raise', passive: 'call', fold: 'fold' }[decision.best];
  if (decision.evLost <= 0) return `baseline: ${best}, on plan`;
  return `baseline: ${best}, ${decision.evLost.toFixed(1)} bb lost`;
}

function ActionList({
  hand,
  states,
  step,
  onPick,
}: {
  hand: Hand;
  states: HandState[];
  step: number;
  onPick: (n: number) => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);

  /* Stepping with the keyboard has to keep the current action in sight, or the
     list and the table stop agreeing about where you are. Instant, not smooth:
     this follows a keypress, it is not an effect. */
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [step]);

  return (
    <aside className="replay-side">
      <span className="h2">Actions</span>
      <ol className="acts-list">
        <li>
          <button
            type="button"
            className="act-row"
            ref={step === 0 ? currentRef : undefined}
            data-current={step === 0 ? '' : undefined}
            onClick={() => onPick(0)}
          >
            <span className="act-seat">Deal</span>
            <span className="act-what">Blinds {hand.sb} and {hand.bb} posted</span>
          </button>
        </li>
        {hand.actions.map((a, i) => {
          const verdict = studyFor(hand, states, i);
          const streetHere = states[i]?.street;
          const streetBefore = i === 0 ? 'pre' : states[i - 1]?.street;
          return (
            <li key={`${i}-${a.s}-${a.a}`}>
              {streetHere !== streetBefore && streetHere && (
                <span className="act-street">{streetText(streetHere)}</span>
              )}
              <button
                type="button"
                className="act-row"
                ref={step === i + 1 ? currentRef : undefined}
                data-current={step === i + 1 ? '' : undefined}
                onClick={() => onPick(i + 1)}
              >
                <span className="act-seat">{hand.seats[a.s]?.name ?? `Seat ${a.s}`}</span>
                <span className="act-what">{actionText(a.a, a.v)}</span>
                {a.to && <span className="act-note">on the clock</span>}
                {verdict && <span className="act-note">{verdict}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function Fairness({ hand }: { hand: Hand }) {
  const checks = useMemo<Check[] | null>(() => {
    if (!hand.seed) return null;
    return verifyHand({
      seed: hand.seed,
      seedHash: hand.seedHash,
      seatCount: hand.seats.length,
      button: hand.button,
      holes: hand.holes,
      board: hand.board,
    });
  }, [hand]);

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }}>
      <span className="h2">Shuffle</span>
      <div className="card fairness">
        <dl className="kv">
          <dt>Commitment</dt>
          <dd className="mono">{hand.seedHash}</dd>
          <dt>Seed</dt>
          <dd className="mono">{hand.seed ?? 'Published when the hand ends'}</dd>
          <dt>Board</dt>
          <dd><BoardText cards={hand.board} /></dd>
        </dl>
        <hr className="separator" />
        {checks ? (
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.key} data-ok={c.ok ? '' : undefined}>
                <span className="check-state">{c.ok ? 'ok' : 'mismatch'}</span>
                <span className="check-label">{c.label}</span>
                <span className="check-detail">{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted">
            Both checks run in this browser once the seed is published: the commitment is rehashed,
            and the deck is re-derived from the seed and dealt again in engine order.
          </span>
        )}
      </div>
    </section>
  );
}
