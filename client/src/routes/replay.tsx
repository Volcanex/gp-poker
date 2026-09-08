import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { replay } from '@opentable/engine';
import type { HandConfig, HandState } from '@opentable/engine';
import { api, ApiError } from '../net/api.ts';
import { liveSeats, startStacks } from '../net/adapt.ts';
import type { Hand, Match, SeatStudy } from '../net/types.ts';
import { useTitle } from '../ui/title.ts';
import { isTextEntry } from '../ui/bits.tsx';
import { Table } from '../table/table.tsx';
import { actionText, streetText } from '../table/labels.ts';
import { stateToView } from '../replay/to-view.ts';
import { verifyHand } from '../replay/fairness.ts';
import type { Check } from '../replay/fairness.ts';
import { BoardText } from '../ui/board-text.tsx';
import { useSession } from '../net/session.tsx';
import {
  AnalysisPanel,
  StreetStrip,
  panelAsks,
  useHandEquities,
} from '../analysis/replay-panel.tsx';
import type { Equities } from '../analysis/replay-panel.tsx';
import {
  askFor,
  contestingSeats,
  knownHoles,
  practiceSpot,
  priceAt,
  priceText,
  revealedSeats,
  streetPoints,
  streetRows,
} from '../analysis/replay-analysis.ts';
import type { EquityAsk, Hole, PracticeSpot, Price, StreetPoint } from '../analysis/replay-analysis.ts';

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

  /* Which table seats were dealt in. The engine works in a dense 0..n-1 index
     over the players in the hand; everything the row records (actions, holes,
     the button) is in table seats, so the two are mapped either way here and
     the table gets its seats back in the chairs they sat in. */
  const seatMap = useMemo(() => liveSeats(hand), [hand]);

  const states = useMemo<HandState[] | null>(() => {
    if (!hand.seed) return null;
    const engineOf = new Map(seatMap.map((seat, i) => [seat, i]));
    const stacks = startStacks(hand, seatMap);
    const config: HandConfig = {
      seats: seatMap.map((seat, i) => ({
        id: hand.seats.find((s) => s.seat === seat)?.userId ?? `seat-${seat}`,
        stack: stacks[i] ?? 0,
      })),
      button: engineOf.get(hand.button) ?? hand.button,
      sb: hand.sb,
      bb: hand.bb,
      seed: hand.seed,
    };
    /* A seat in the log that never sat down is a broken row: the replay fails
       here rather than quietly attributing the action to someone else. */
    const actions = hand.actions.map((a) => ({ ...a, s: engineOf.get(a.s) ?? -1 }));
    try {
      return replay(config, actions);
    } catch {
      return null;
    }
  }, [hand, seatMap]);

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

  const at = clampStep(step);
  const view = states ? stateToView(hand, states[at], at, showAll, seatMap) : null;
  const analysis = useAnalysis(hand, states, seatMap, at, showAll);

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

            <AnalysisPanel
              seats={analysis.seats}
              known={analysis.known}
              live={analysis.live}
              board={analysis.board}
              street={states[at].street}
              equities={analysis.equities}
              spot={analysis.spot}
              colourOf={analysis.colourOf}
            />

            <StreetStrip
              points={analysis.points}
              known={analysis.known}
              seats={analysis.seats}
              equities={analysis.equities}
              colourOf={analysis.colourOf}
            />
          </div>

          <ActionList
            hand={hand}
            states={states}
            step={at}
            onPick={setStep}
            prices={analysis.prices}
            equities={analysis.equities}
          />
        </div>
      )}

      <Fairness hand={hand} />
    </main>
  );
}

/* The whole analysis of one step, gathered in one place because three parts of
   the page read it: the panel under the felt, the strip under that, and the
   price beside every call in the list.

   One rule decides what may be analysed, and it is the felt's rule: a hand
   nobody showed is nobody's to read. So the panel knows your own cards if you
   played, everybody's once the hand reaches its showdown, and everybody's at
   any step while "show all cards" is on. Stepping back before the showdown
   takes the numbers away again, which is the honest thing for a replay to do.

   The asks go to the worker in this order: the step on screen first, then the
   action it arrived on, then the strip, then every other price. The worker
   answers one at a time, so the order is the priority. */
function useAnalysis(
  hand: Hand,
  states: HandState[] | null,
  seatMap: number[],
  at: number,
  showAll: boolean,
) {
  const { me } = useSession();
  const mySeat = useMemo(() => {
    if (!me) return null;
    return hand.seats.find((s) => s.userId === me.id)?.seat ?? null;
  }, [hand, me]);

  const state = states?.[at] ?? null;

  const known = useMemo<Map<number, Hole>>(
    () =>
      knownHoles({
        holes: hand.holes,
        seats: seatMap,
        revealed: state ? revealedSeats(state, seatMap) : [],
        mine: mySeat,
        showAll,
      }),
    [hand, seatMap, state, mySeat, showAll],
  );

  const live = useMemo(() => (state ? contestingSeats(state, seatMap) : []), [state, seatMap]);
  const board = state ? state.board : [];
  const points = useMemo<StreetPoint[]>(() => (states ? streetPoints(states, seatMap) : []), [states, seatMap]);

  /* The price of every call and raise in the log, read off the state it was
     made in, with the question that says how good the hand paying it was. */
  const prices = useMemo<(PriceRow | null)[]>(() => {
    if (!states) return [];
    return hand.actions.map((a, i) => {
      const before = states[i];
      if (!before) return null;
      const price = priceAt(before, a, seatMap);
      if (!price) return null;
      return { price, ask: askFor(a.s, before.board, contestingSeats(before, seatMap), known) };
    });
  }, [hand, states, seatMap, known]);

  const asks = useMemo<EquityAsk[]>(() => {
    const out: EquityAsk[] = [];
    const seen = new Set<string>();
    const push = (ask: EquityAsk | null) => {
      if (!ask || seen.has(ask.key)) return;
      seen.add(ask.key);
      out.push(ask);
    };
    for (const ask of panelAsks(known, live, board)) push(ask);
    push(prices[at - 1]?.ask ?? null);
    for (const row of streetRows(points, known)) for (const cell of row.cells) push(cell.ask);
    for (const row of prices) push(row?.ask ?? null);
    return out;
  }, [known, live, board, points, prices, at]);

  const equities = useHandEquities(asks);

  const spot = useMemo<PracticeSpot | null>(() => {
    if (!states || at === 0) return null;
    const before = states[at - 1];
    const action = hand.actions[at - 1];
    if (!before || !action) return null;
    return practiceSpot(before, action, seatMap, known);
  }, [states, hand, seatMap, at, known]);

  const seats = useMemo(
    () =>
      seatMap.map((seat) => ({
        seat,
        name: hand.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat}`,
      })),
    [hand, seatMap],
  );

  /* A seat keeps one colour for the whole page, taken from where it sits at
     the table rather than from who happens to have shown a hand, so the dot
     beside a name means the same thing at every step. */
  const colourOf = useCallback(
    (seat: number) => (Math.max(0, seatMap.indexOf(seat)) % 6) + 1,
    [seatMap],
  );

  return { seats, known, live, board, points, prices, equities, spot, colourOf };
}

interface PriceRow {
  price: Price;
  ask: EquityAsk | null;
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
  prices,
  equities,
}: {
  hand: Hand;
  states: HandState[];
  step: number;
  onPick: (n: number) => void;
  prices: (PriceRow | null)[];
  equities: Equities;
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
                <span className="act-seat">
                  {hand.seats.find((s) => s.seat === a.s)?.name ?? `Seat ${a.s}`}
                </span>
                <span className="act-what">{actionText(a.a, a.v)}</span>
                {a.to && <span className="act-note">on the clock</span>}
                {verdict && <span className="act-note">{verdict}</span>}
                <PriceNote row={prices[i] ?? null} equities={equities} />
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* What the call cost, and whether the hand paying it was worth the price. The
   share needed is arithmetic and is always there; the equity beside it is only
   there once that seat has shown its cards. */
function PriceNote({ row, equities }: { row: PriceRow | null; equities: Equities }) {
  if (!row) return null;
  const equity = row.ask ? equities.get(row.ask.key)?.equity ?? null : null;
  const clears = equity != null && equity >= row.price.needed;
  return (
    <span className="act-price" data-clears={clears ? '' : undefined}>
      {priceText(row.price, equity)}
    </span>
  );
}

function Fairness({ hand }: { hand: Hand }) {
  const checks = useMemo<Check[] | null>(() => {
    if (!hand.seed) return null;
    const seats = liveSeats(hand);
    const button = seats.indexOf(hand.button);
    return verifyHand({
      seed: hand.seed,
      seedHash: hand.seedHash,
      seatCount: seats.length,
      button: button < 0 ? hand.button : button,
      seats,
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
