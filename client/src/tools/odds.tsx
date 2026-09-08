/* Pot odds trainer. A spot, a price, and one question: is your equity bigger
   than the fraction of the pot you are being asked to put in?

   The equity is against random hands, which is the honest thing to train
   against here: the point is the arithmetic of the price, not a read. Every
   number is computed in the analysis worker while you think, so the answer is
   already there when you press a key.

   The page is built to be read at a glance and repeated fast, so every box
   whose contents change has a reserved size. See ./CLAUDE.md. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import NumberFlow from '@number-flow/react';
import { useAnimate, useReducedMotion } from 'motion/react';
import { FULL_DECK } from '@opentable/equity/cards';
import type { EquityResult, OutsResult } from '@opentable/equity';
import { analyse, analyseOuts, cancel, isCancelled, nextRequestId } from '../analysis/index.ts';
import { isTextEntry } from '../ui/bits.tsx';
import { readCards } from './cards.tsx';
import { PlayingCard } from '../table/playing-card.tsx';
import { useTitle } from '../ui/title.ts';

const STORE = 'ot.odds';
const BET_FRACTIONS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];

export type Street = 'flop' | 'turn' | 'river';
export const STREETS: Street[] = ['flop', 'turn', 'river'];
const BOARD_SIZE: Record<Street, number> = { flop: 3, turn: 4, river: 5 };
const STREET_LABEL: Record<Street, string> = { flop: 'Flop', turn: 'Turn', river: 'River' };

/* Running out of time is an answer, so it lives with the other two. */
export type Answer = 'call' | 'fold' | 'timeout';

export interface Spot {
  hero: [string, string];
  board: string[];
  pot: number; // what is out there before you call, their bet included
  bet: number; // what it costs you
  opponents: number;
}

export interface Score {
  right: number;
  total: number;
  streak: number;
  best: number;
}

/* One key holds the record and the two practice settings, because they are one
   thing to a player: how this trainer is set up for them. */
export interface Saved extends Score {
  timer: boolean;
  streets: Street[];
}

const EMPTY: Saved = { right: 0, total: 0, streak: 0, best: 0, timer: false, streets: STREETS };

export const TIMER_MS = 10_000;

/* The share of the final pot your call has to win to break even. */
export function requiredEquity(spot: Spot): number {
  return spot.bet / (spot.pot + spot.bet);
}

export function callIsRight(equity: number, spot: Spot): boolean {
  return equity >= requiredEquity(spot);
}

/* Running out of time is a wrong answer rather than a missing one: a price you
   cannot read in ten seconds is a price you would have got wrong at the table. */
export function answerIsRight(answer: Answer, equity: number, spot: Spot): boolean {
  if (answer === 'timeout') return false;
  return callIsRight(equity, spot) === (answer === 'call');
}

export function accuracy(score: Score): number {
  return score.total === 0 ? 0 : (score.right / score.total) * 100;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/* The price the way a player says it out loud: the pot against the call, cut
   down to the smallest whole numbers that still say it. A pot that does not
   divide cleanly is read against one instead, because "37 to 14" is not odds
   anybody quotes. */
export function priceRatio(pot: number, bet: number): string {
  if (!(pot > 0) || !(bet > 0)) return '';
  const a = Math.round(pot);
  const b = Math.round(bet);
  const g = gcd(a, b) || 1;
  const x = a / g;
  const y = b / g;
  if (y <= 9 && x <= 99) return `${x} to ${y}`;
  return `${(a / b).toFixed(1)} to 1`;
}

/* One sentence saying what the spot was and why, in the same shape every time
   so the eye learns where the two numbers sit. */
export function verdictLine(equity: number, spot: Spot): string {
  const win = Math.round(equity * 100);
  const need = Math.round(requiredEquity(spot) * 100);
  const action = callIsRight(equity, spot) ? 'Call' : 'Fold';
  return `${action}. You win ${win}% and needed ${need}%.`;
}

export type Tone = 'none' | 'warm' | 'hot' | 'blaze';

/* Three thresholds, so a run has somewhere to get to. Three is the first one
   worth noticing, five is a good session, ten is rare. */
export function streakTone(streak: number): Tone {
  if (streak >= 10) return 'blaze';
  if (streak >= 5) return 'hot';
  if (streak >= 3) return 'warm';
  return 'none';
}

const TONE_BADGE: Record<Tone, { cls: string; text: string }> = {
  none: { cls: 'badge-plain', text: 'Building' },
  warm: { cls: 'badge-info', text: 'Warm' },
  hot: { cls: 'badge-ok', text: 'Hot' },
  blaze: { cls: 'badge-warn', text: 'On fire' },
};

/* What is left of the clock, as a fraction of the bar. Clamped at both ends so
   a tab that slept while a spot was open cannot draw a negative bar. */
export function timerLeft(elapsed: number, total = TIMER_MS): number {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - elapsed / total));
}

export function timedOut(elapsed: number, total = TIMER_MS): boolean {
  return elapsed >= total;
}

/* An unknown or empty list of streets is every street rather than none: a
   filter that filtered everything out would leave the trainer with nothing to
   deal. */
export function readStreets(value: unknown): Street[] {
  if (!Array.isArray(value)) return STREETS;
  const kept = STREETS.filter((street) => value.includes(street));
  return kept.length > 0 ? kept : STREETS;
}

export function readSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return {
      right: Number(parsed.right) || 0,
      total: Number(parsed.total) || 0,
      streak: Number(parsed.streak) || 0,
      best: Number(parsed.best) || 0,
      timer: parsed.timer === true,
      streets: readStreets(parsed.streets),
    };
  } catch {
    return EMPTY;
  }
}

export function writeSaved(saved: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    // A browser with storage turned off still gets to practise.
  }
}

export function scoreAfter(score: Score, right: boolean): Score {
  const streak = right ? score.streak + 1 : 0;
  return {
    right: score.right + (right ? 1 : 0),
    total: score.total + 1,
    streak,
    best: Math.max(score.best, streak),
  };
}

function pick<T>(list: T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

export function dealSpot(random: () => number = Math.random, streets: Street[] = STREETS): Spot {
  const deck = [...FULL_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const boardSize = BOARD_SIZE[pick(streets.length > 0 ? streets : STREETS, random)];
  const pot = 10 + Math.round(random() * 25) * 2;
  const bet = Math.max(1, Math.round(pot * pick(BET_FRACTIONS, random)));
  return {
    hero: [deck[0], deck[1]],
    board: deck.slice(2, 2 + boardSize),
    pot,
    bet,
    opponents: random() < 0.7 ? 1 : 2,
  };
}

/* A spot handed over from somewhere else, most often a call in a replayed
   hand: /tools/odds?hand=AhKd&board=Qs7h2c&pot=24&bet=8&opponents=1.

   Every part of it has to read, and any part that does not sends the page back
   to its own generator rather than showing a spot half built from a link. The
   board may be any street: a river call is a real price even though there are
   no cards to come. */
export function spotFromQuery(search: string): Spot | null {
  const params = new URLSearchParams(search);
  const hero = readCards(params.get('hand') ?? '');
  const board = readCards(params.get('board') ?? '');
  if (!hero || hero.length !== 2 || !board || board.length > 5) return null;
  if (new Set([...hero, ...board]).size !== hero.length + board.length) return null;

  const pot = Number(params.get('pot'));
  const bet = Number(params.get('bet'));
  const opponents = Number(params.get('opponents') ?? '1');
  if (!Number.isFinite(pot) || !Number.isFinite(bet) || pot <= 0 || bet <= 0) return null;
  if (!Number.isFinite(opponents)) return null;

  return {
    hero: [hero[0], hero[1]],
    board,
    pot: Math.round(pot),
    bet: Math.round(bet),
    opponents: Math.max(1, Math.min(8, Math.round(opponents))),
  };
}

/* Outs are a question about the cards to come, so a river spot has none and a
   preflop one has too many to name. Either way the trainer is still a price. */
export function outsReadable(board: string[]): boolean {
  return board.length === 3 || board.length === 4;
}

const OPPONENT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

export function Odds() {
  const { search } = useLocation();
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [spot, setSpot] = useState<Spot>(() => spotFromQuery(search) ?? dealSpot());
  const [fromLink, setFromLink] = useState(() => spotFromQuery(search) !== null);
  const [equity, setEquity] = useState<EquityResult | null>(null);
  const [outs, setOuts] = useState<OutsResult | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [left, setLeft] = useState(1);
  const [bump, setBump] = useState({ n: 0, right: true });
  const answered = useRef(false);
  const reduced = useReducedMotion();
  const [tile, animateTile] = useAnimate<HTMLDivElement>();
  useTitle('Pot odds trainer');

  const { timer: timerOn, streets } = saved;

  useEffect(() => setSaved(readSaved()), []);

  useEffect(() => {
    const ids = [nextRequestId('e'), nextRequestId('o')];
    let live = true;
    setEquity(null);
    setOuts(null);
    const jobs: Promise<unknown>[] = [
      analyse({
        id: ids[0],
        hero: spot.hero,
        board: spot.board,
        villains: Array.from({ length: spot.opponents }, () => 'random' as const),
      }).then((r) => live && setEquity(r)),
    ];
    if (outsReadable(spot.board)) {
      jobs.push(analyseOuts({ id: ids[1], hero: spot.hero, board: spot.board }).then((r) => live && setOuts(r)));
    }
    Promise.all(jobs).catch((err) => {
      if (!live || isCancelled(err)) return;
      console.error(err);
    });
    return () => {
      live = false;
      for (const id of ids) cancel(id);
    };
  }, [spot]);

  const next = useCallback(() => {
    answered.current = false;
    setAnswer(null);
    setFromLink(false);
    setSpot(dealSpot(Math.random, streets));
  }, [streets]);

  const answerWith = useCallback(
    (choice: Answer) => {
      if (answered.current || !equity) return;
      answered.current = true;
      setAnswer(choice);
      const right = answerIsRight(choice, equity.equity, spot);
      setSaved((prev) => {
        const updated = { ...prev, ...scoreAfter(prev, right) };
        writeSaved(updated);
        return updated;
      });
      setBump((prev) => ({ n: prev.n + 1, right }));
    },
    [equity, spot],
  );

  /* The clock runs only while there is something to answer, and it starts when
     the equity lands rather than when the spot is dealt: the buttons are dead
     until then, so a spot that took a moment to work out would otherwise cost
     the player part of their ten seconds. */
  useEffect(() => {
    setLeft(1);
    if (!timerOn || answer !== null || !equity) return;
    const start = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - start;
      setLeft(timerLeft(elapsed));
      if (timedOut(elapsed)) answerWith('timeout');
    }, 100);
    return () => clearInterval(id);
  }, [timerOn, answer, equity, answerWith]);

  /* The tile answers every spot, including two right ones in a row, so the
     animation is fired rather than declared: a repeated keyframe set is the
     same object and would not run twice. */
  useEffect(() => {
    if (bump.n === 0 || reduced || !tile.current) return;
    void animateTile(
      tile.current,
      bump.right ? { scale: [1, 1.06, 1] } : { x: [0, -5, 5, -3, 3, 0] },
      { duration: 0.33, ease: [0.2, 0, 0, 1] },
    );
  }, [bump, reduced, animateTile, tile]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
      const key = event.key.toLowerCase();
      if (!answer && (key === 'c' || key === 'f')) {
        event.preventDefault();
        answerWith(key === 'c' ? 'call' : 'fold');
      } else if (answer && (key === 'n' || key === 'enter' || key === ' ')) {
        /* Enter and space already press a focused button. Taking them here as
           well would deal two spots for one keystroke. */
        if ((event.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        event.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, answerWith, next]);

  const setSetting = useCallback((change: Partial<Saved>) => {
    setSaved((prev) => {
      const updated = { ...prev, ...change };
      writeSaved(updated);
      return updated;
    });
  }, []);

  const toggleStreet = useCallback(
    (street: Street) => {
      setSaved((prev) => {
        const chosen = prev.streets.includes(street)
          ? prev.streets.filter((s) => s !== street)
          : STREETS.filter((s) => s === street || prev.streets.includes(s));
        const updated = { ...prev, streets: chosen.length > 0 ? chosen : prev.streets };
        writeSaved(updated);
        return updated;
      });
    },
    [],
  );

  const required = requiredEquity(spot);
  /* The equity is worked out while the player thinks, so it exists long before
     it may be shown. This is the one gate on printing it. */
  const shown = answer !== null && equity ? equity : null;
  const right = shown && answer !== null ? answerIsRight(answer, shown.equity, spot) : false;
  const tone: Tone = answer && !right ? 'none' : streakTone(saved.streak);
  const badge = answer && !right ? { cls: 'badge-danger', text: 'Missed' } : TONE_BADGE[tone];
  const opponents = spot.opponents;
  const heroWord = useMemo(
    () => `${OPPONENT_WORDS[opponents] ?? opponents} ${opponents === 1 ? 'opponent' : 'opponents'}`,
    [opponents],
  );
  const rate = saved.total ? accuracy(saved) : 0;
  const zone = saved.total === 0 ? undefined : rate >= 70 ? 'ok' : rate >= 50 ? 'warn' : 'danger';

  const outsNote = !outsReadable(spot.board)
    ? spot.board.length >= 5
      ? 'No cards to come.'
      : ''
    : outs
      ? `${outs.count} outs${outs.draws.length > 0 ? `: ${outs.draws.join(', ')}` : ''}.`
      : '';
  const sampleNote = equity
    ? equity.exact
      ? 'Counted exactly.'
      : `Sampled over ${equity.samples.toLocaleString('en-GB')} deals.`
    : '';

  return (
    <main className="page stack tools-page odds-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Pot odds trainer</h1>
        <p className="muted">
          One question, over and over: does your hand win often enough to pay the price in front of
          you? Equity here is against random hands, so it is a floor rather than a read. Ranges live
          in the <Link to="/tools/ranges">range explorer</Link>.
        </p>
      </div>

      <section className="card stack odds-spot" aria-label="The spot">
        <div className="odds-figures">
          <div className="fig">
            <span className="label">Pot</span>
            <span className="fig-v num">
              <NumberFlow value={spot.pot} format={{ useGrouping: false }} respectMotionPreference />
            </span>
          </div>
          <div className="fig">
            <span className="label">To call</span>
            <span className="fig-v num">
              <NumberFlow value={spot.bet} format={{ useGrouping: false }} respectMotionPreference />
            </span>
          </div>
          <div className="odds-price">
            <span className="price-ratio num">{priceRatio(spot.pot, spot.bet)}</span>
            <span className="price-need num">Needs {Math.round(required * 100)}%</span>
          </div>
        </div>

        <div className="odds-hands">
          <div className="field">
            <span className="label">Your hand</span>
            <div className="odds-cards">
              {spot.hero.map((card) => (
                <PlayingCard key={card} card={card} still />
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Board</span>
            <div className="odds-cards">
              {spot.board.length === 0 ? (
                <span className="muted">No board</span>
              ) : (
                spot.board.map((card) => <PlayingCard key={card} card={card} still />)
              )}
            </div>
          </div>
        </div>

        <p className="spot-line">
          Against {heroWord}
          {fromLink ? ', from a hand you were replaying.' : '.'}
        </p>

        {timerOn && (
          <div
            className="g-progress odds-timer"
            role="progressbar"
            aria-label="Time left in this spot"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(left * 100)}
            data-low={left <= 0.3 ? '' : undefined}
          >
            <span className="g-progress-fill" style={{ width: `${left * 100}%` }} />
          </div>
        )}

        <div className="odds-acts">
          <button
            type="button"
            className={`btn ${answer ? 'btn-secondary' : 'btn-primary'}`}
            data-picked={answer === 'call' ? '' : undefined}
            onClick={() => answerWith('call')}
            disabled={!equity || answer !== null}
          >
            Call
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-picked={answer === 'fold' ? '' : undefined}
            onClick={() => answerWith('fold')}
            disabled={!equity || answer !== null}
          >
            Fold
          </button>
          <button
            type="button"
            className={`btn ${answer ? 'btn-primary' : 'btn-secondary'}`}
            onClick={next}
            disabled={answer === null}
          >
            Next spot
          </button>
        </div>

        <p className="odds-hint muted small">
          {answer === null ? (
            equity ? (
              <>
                Press <span className="kbd">C</span> to call or <span className="kbd">F</span> to
                fold.
              </>
            ) : (
              'Working out the spot.'
            )
          ) : (
            <>
              Press <span className="kbd">Enter</span> for the next spot.
            </>
          )}
        </p>

        {/* The reveal is drawn before it has anything to say, empty bars and
            all. That is what keeps the answer from pushing the record down the
            page, and it shows the scale the answer will be read against. */}
        <div className="odds-reveal" aria-live="polite" data-shown={shown ? '' : undefined}>
          <p className="verdict-line">
            {shown ? (
              <>
                <span className={`badge ${right ? 'badge-ok' : answer === 'timeout' ? 'badge-warn' : 'badge-danger'}`}>
                  {right ? 'Right' : answer === 'timeout' ? 'Out of time' : 'Not this one'}
                </span>
                <span>{verdictLine(shown.equity, spot)}</span>
              </>
            ) : (
              <span className="muted">Call or fold, and the two numbers land here.</span>
            )}
          </p>

          <div className="eq-chart">
            <div className="eq-row" data-k="win">
              <span className="eq-name">You win</span>
              <span className="eq-bar">
                <span
                  className="eq-fill"
                  style={{ width: shown ? `${Math.min(100, shown.equity * 100)}%` : '0%' }}
                />
              </span>
              <span className="eq-v num">{shown ? `${Math.round(shown.equity * 100)}%` : '…'}</span>
            </div>
            <div className="eq-row" data-k="need">
              <span className="eq-name">You need</span>
              <span className="eq-bar">
                <span className="eq-fill" style={{ width: `${Math.min(100, required * 100)}%` }} />
              </span>
              <span className="eq-v num">{Math.round(required * 100)}%</span>
            </div>
            <div className="eq-scale" aria-hidden="true">
              <span />
              <span className="eq-ticks">
                <i className="num">0%</i>
                <i className="num">50%</i>
                <i className="num">100%</i>
              </span>
              <span />
            </div>
          </div>

          <p className="reveal-note muted small">
            {shown ? [outsNote, sampleNote].filter(Boolean).join(' ') : ''}
          </p>
        </div>
      </section>

      <section className="card odds-score" aria-label="Your record">
        <div className="streak-tile" ref={tile} data-tone={tone} data-miss={answer && !right ? '' : undefined}>
          <span className="label">Streak</span>
          <span className="streak-v num">
            <NumberFlow value={saved.streak} format={{ useGrouping: false }} respectMotionPreference />
          </span>
          <span className={`badge ${badge.cls}`}>{badge.text}</span>
        </div>

        <div className="score-cell">
          <span className="label">Accuracy</span>
          <span className="score-v num">{saved.total ? `${Math.round(rate)}%` : '…'}</span>
          <span
            className="g-meter"
            role="meter"
            aria-label="Accuracy"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(rate)}
            data-zone={zone}
          >
            <span className="g-meter-fill" style={{ width: `${rate}%` }} />
          </span>
        </div>

        <div className="score-cell">
          <span className="label">Best streak</span>
          <span className="score-v num">{saved.best}</span>
        </div>

        <div className="score-cell">
          <span className="label">Spots</span>
          <span className="score-v num">{saved.total}</span>
        </div>
      </section>

      <section className="card odds-settings" aria-label="How you practise">
        <label className="switch-row">
          <span className="label">Ten second timer</span>
          <input
            type="checkbox"
            className="switch"
            checked={timerOn}
            onChange={(e) => setSetting({ timer: e.target.checked })}
          />
        </label>

        <fieldset className="odds-streets">
          <legend className="label">Streets to deal</legend>
          {STREETS.map((street) => (
            <label className="check-row" key={street}>
              <input
                type="checkbox"
                className="checkbox"
                checked={streets.includes(street)}
                onChange={() => toggleStreet(street)}
              />
              <span>{STREET_LABEL[street]}</span>
            </label>
          ))}
        </fieldset>
      </section>
    </main>
  );
}
