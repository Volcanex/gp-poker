/* The analysis panel under a replayed hand: what every seat held at this step,
   how often it was winning, and what it would have cost to keep going.

   Everything expensive is the worker's, and it is asked one question at a
   time. The asks arrive as a list in priority order, so the step on screen is
   answered before the strip that fills in behind it, and an answer is kept
   under a key that says what was asked rather than who asked it: the same
   seat, board and field of opponents is one computation whether the panel, an
   action's price or the strip wanted it.

   Nothing here sizes to its content. The numbers land after the labels beside
   them are painted, so every cell that holds one is a fixed box. */

import { useEffect, useReducer, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { EquityResult } from '@opentable/equity';
import type { Street } from '@opentable/protocol';
import { BoardText } from '../ui/board-text.tsx';
import { analyse, analyseName, analyseOuts, cancel, isCancelled, nextRequestId } from './index.ts';
import type { Card, HandNaming, OutsRead } from './index.ts';
import { outsLine } from './live-stats.tsx';
import { askFor, percent, streetRows } from './replay-analysis.ts';
import type { EquityAsk, Hole, PracticeSpot, StreetPoint, StreetRow } from './replay-analysis.ts';
import { practiceQuery } from './replay-analysis.ts';
import './replay-panel.css';

/* Sampled rather than exact wherever the enumeration is too big, which
   preflop always is. Ten thousand deals is a tenth of a percent of noise and
   about a fifth of the wait of the table's twenty thousand, and the panel asks
   the question many more times than a table ever does. */
const PANEL_SAMPLES = 10_000;
const MAX_OUTS_SHOWN = 6;

export type Equities = Map<string, EquityResult>;

/* One question in flight at a time, in the order the page asked them.

   A replayed hand is dozens of small questions, and firing them all at the
   worker would put the strip's preflop enumeration in front of the street the
   viewer is actually looking at. Resolving the list in order instead means the
   first unanswered ask is always the most useful one, and stepping cancels
   whatever is outstanding and re-enters the queue at the new step. Answers are
   kept for the life of the page: a hand has one set of holdings, so a question
   asked twice has the same answer both times. */
export function useHandEquities(asks: EquityAsk[]): Equities {
  const cache = useRef<Equities>(new Map());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const signature = asks.map((a) => a.key).join('|');

  useEffect(() => {
    let live = true;
    let outstanding: string | null = null;
    void (async () => {
      for (const ask of asks) {
        if (!live) return;
        if (cache.current.has(ask.key)) continue;
        const id = nextRequestId('rq');
        outstanding = id;
        try {
          const result = await analyse({
            id,
            hero: ask.hero,
            board: ask.board,
            villains: ask.villains,
            samples: PANEL_SAMPLES,
          });
          if (!live) return;
          cache.current.set(ask.key, result);
          bump();
        } catch (err) {
          if (!live || isCancelled(err)) return;
          console.error(err);
        } finally {
          outstanding = null;
        }
      }
    })();
    return () => {
      live = false;
      if (outstanding) cancel(outstanding);
    };
    /* The list of keys is the whole input: a new step asks a new list. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return cache.current;
}

interface Reads {
  names: Map<string, HandNaming>;
  outs: Map<string, OutsRead>;
}

/* Naming a hand and counting its outs are milliseconds either way, so these go
   together and go in parallel, unlike the equities above. */
function useHandReads(hands: { key: string; hero: Hole; board: Card[] }[]): Reads {
  const names = useRef(new Map<string, HandNaming>());
  const outs = useRef(new Map<string, OutsRead>());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const signature = hands.map((h) => h.key).join('|');

  useEffect(() => {
    let live = true;
    const ids: string[] = [];
    const jobs: Promise<unknown>[] = [];
    for (const hand of hands) {
      const cards = [...hand.hero, ...hand.board];
      if (hand.board.length >= 3 && !names.current.has(hand.key)) {
        const id = nextRequestId('nm');
        ids.push(id);
        jobs.push(
          analyseName({ id, cards }).then((r) => {
            if (live) names.current.set(hand.key, r);
          }),
        );
      }
      if ((hand.board.length === 3 || hand.board.length === 4) && !outs.current.has(hand.key)) {
        const id = nextRequestId('ot');
        ids.push(id);
        jobs.push(
          analyseOuts({ id, hero: hand.hero, board: hand.board }).then((r) => {
            if (live) outs.current.set(hand.key, r);
          }),
        );
      }
    }
    if (jobs.length === 0) return;
    Promise.all(jobs)
      .then(() => live && bump())
      .catch((err) => {
        if (!live || isCancelled(err)) return;
        console.error(err);
      });
    return () => {
      live = false;
      for (const id of ids) cancel(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { names: names.current, outs: outs.current };
}

function readKey(hero: Hole, board: Card[]): string {
  return `${hero.join('')}/${board.join('')}`;
}

/* The asks the panel itself needs: one per known seat still in the hand, at
   the board this step is standing on. */
export function panelAsks(known: Map<number, Hole>, live: number[], board: Card[]): EquityAsk[] {
  const asks: EquityAsk[] = [];
  for (const seat of live) {
    const ask = askFor(seat, board, live, known);
    if (ask) asks.push(ask);
  }
  return asks;
}

export interface AnalysisPanelProps {
  seats: { seat: number; name: string }[];
  known: Map<number, Hole>;
  live: number[];
  board: Card[];
  street: Street;
  equities: Equities;
  spot: PracticeSpot | null;
  colourOf: (seat: number) => number;
}

export function AnalysisPanel({
  seats,
  known,
  live,
  board,
  street,
  equities,
  spot,
  colourOf,
}: AnalysisPanelProps) {
  const reads = useHandReads(
    live
      .filter((s) => known.has(s))
      .map((s) => ({ key: readKey(known.get(s) as Hole, board), hero: known.get(s) as Hole, board })),
  );
  const asks = panelAsks(known, live, board);
  const askBySeat = new Map(asks.map((a) => [a.seat, a]));

  return (
    <section className="card ra-panel" aria-label="Hand analysis">
      <header className="ra-head">
        <span className="h2">Analysis</span>
        <span className="ra-street">{streetLabel(street, board)}</span>
        <span className="ra-spacer" />
        {spot && (
          <Link className="btn btn-secondary btn-sm" to={practiceQuery(spot)}>
            Practice this spot
          </Link>
        )}
      </header>

      {known.size === 0 ? (
        <p className="muted small ra-note">
          Nobody has shown a hand yet. Turn on show all cards to analyse every seat, or step to the
          showdown.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table ra-table">
            <thead>
              <tr>
                <th scope="col" className="ra-seat">Seat</th>
                <th scope="col" className="ra-equity">Equity</th>
                <th scope="col" className="ra-cards">Cards</th>
                <th scope="col" className="ra-name">Hand</th>
                <th scope="col" className="ra-outs">Outs</th>
              </tr>
            </thead>
            <tbody>
              {seats.map(({ seat, name }) => {
                const hero = known.get(seat) ?? null;
                const inHand = live.includes(seat);
                const ask = askBySeat.get(seat);
                const result = ask ? equities.get(ask.key) : undefined;
                const read = hero ? readKey(hero, board) : '';
                const naming = hero ? reads.names.get(read) : undefined;
                const line = hero ? outsLine(reads.outs.get(read) ?? null) : null;
                const shown = line?.cards.slice(0, MAX_OUTS_SHOWN) ?? [];
                const hidden = (line?.cards.length ?? 0) - shown.length;
                return (
                  <tr key={seat} data-folded={inHand ? undefined : ''}>
                    <th scope="row" className="ra-seat" title={name}>
                      <span className="ra-dot" data-chart={hero ? colourOf(seat) : undefined} />
                      {name}
                    </th>
                    <td className="num ra-equity">
                      {!hero ? (
                        ''
                      ) : !inHand ? (
                        <span className="muted">Folded</span>
                      ) : !ask ? (
                        <span className="muted">Uncontested</span>
                      ) : result ? (
                        <>
                          {percent(result.equity)}
                          <span className="ra-sub">{result.exact ? 'Exact' : `Sampled, ${result.samples.toLocaleString('en-GB')}`}</span>
                        </>
                      ) : (
                        <Waiting />
                      )}
                    </td>
                    <td className="ra-cards">
                      {hero ? <BoardText cards={hero} /> : <span className="muted">Hidden</span>}
                    </td>
                    <td className="ra-name" title={naming?.name}>
                      {!hero ? '' : board.length < 3 ? <span className="muted">Preflop</span> : naming?.name ?? <Waiting />}
                    </td>
                    <td className="ra-outs">
                      {!hero || !inHand ? (
                        ''
                      ) : board.length !== 3 && board.length !== 4 ? (
                        <span className="muted">{board.length >= 5 ? 'None to come' : 'From the flop'}</span>
                      ) : line ? (
                        <>
                          <span className={line.muted ? 'muted' : 'num'}>{line.label}</span>
                          {shown.length > 0 && <BoardText cards={shown} />}
                          {hidden > 0 && <span className="muted"> and {hidden} more</span>}
                        </>
                      ) : (
                        <Waiting />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function streetLabel(street: Street, board: Card[]): string {
  const words: Record<string, string> = {
    pre: 'Preflop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
    done: 'Hand over',
  };
  const word = words[street] ?? 'Hand over';
  return board.length === 0 ? word : `${word}, ${board.length} cards down`;
}

function Waiting() {
  return <span className="muted ra-waiting">Computing</span>;
}

export interface StreetStripProps {
  points: StreetPoint[];
  known: Map<number, Hole>;
  seats: { seat: number; name: string }[];
  equities: Equities;
  colourOf: (seat: number) => number;
}

const STREET_WORDS: Record<string, string> = {
  pre: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

/* Equity across the streets, every seat on the same scale.

   One scale is the whole point of drawing it: two lines that each fill their
   own box say nothing about each other, and the question this answers is who
   was in front and when. So nought to a hundred percent, always, with a
   halfway line to read against, and the numbers beside the shape rather than
   inside it, where they would be four pixels tall on a phone. */
export function StreetStrip({ points, known, seats, equities, colourOf }: StreetStripProps) {
  const rows = streetRows(points, known);
  const nameOf = new Map(seats.map((s) => [s.seat, s.name]));
  if (rows.length === 0) return null;

  return (
    <section className="card ra-panel" aria-label="Equity by street">
      <header className="ra-head">
        <span className="h2">Equity by street</span>
        <span className="ra-street">Same scale, nought to a hundred percent</span>
      </header>
      <div className="table-wrap">
        <table className="table ra-strip">
          <thead>
            <tr>
              {/* The same fixed width the panel's own Seat column carries
                  above, so the two cards' first columns line up rather than
                  each settling on whatever its own longest name measures. */}
              <th scope="col" className="ra-seat">Seat</th>
              <th scope="col" className="ra-shape">Shape</th>
              {points.map((p) => (
                <th scope="col" key={p.street}>{STREET_WORDS[p.street] ?? p.street}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <StripRow
                key={row.seat}
                row={row}
                points={points}
                name={nameOf.get(row.seat) ?? `Seat ${row.seat}`}
                colour={colourOf(row.seat)}
                equities={equities}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const W = 108;
const H = 30;
const PAD = 3;

function StripRow({
  row,
  points,
  name,
  colour,
  equities,
}: {
  row: StreetRow;
  points: StreetPoint[];
  name: string;
  colour: number;
  equities: Equities;
}) {
  const byStreet = new Map(row.cells.map((c) => [c.street, c]));
  const answers = points.map((p) => {
    const cell = byStreet.get(p.street);
    if (!cell) return null;
    if (!cell.ask) return { equity: 1, note: 'The pot was uncontested' };
    const result = equities.get(cell.ask.key);
    if (!result) return null;
    return {
      equity: result.equity,
      note: result.exact ? 'Exact' : `Sampled, ${result.samples.toLocaleString('en-GB')} deals`,
    };
  });
  const values = answers.map((a) => (a == null ? null : a.equity));

  const span = Math.max(1, points.length - 1);
  const x = (i: number) => PAD + (i / span) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - v) * (H - PAD * 2);
  const drawn = values
    .map((v, i) => (v == null ? null : { x: x(i), y: y(v) }))
    .filter((p): p is { x: number; y: number } => p !== null);
  const line = drawn.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <tr>
      <th scope="row" className="ra-seat" title={name}>
        <span className="ra-dot" data-chart={colour} />
        {name}
      </th>
      <td className="ra-shape">
        {/* A bare midline with no point on it reads as an empty box, not a
            chart still filling in: nothing here says a number is coming.
            Nought points drawn is the one state worth a word instead. */}
        {drawn.length === 0 ? (
          <Waiting />
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={`${name}: ${values.map((v, i) => `${STREET_WORDS[points[i].street] ?? ''} ${v == null ? 'not worked out yet' : percent(v)}`).join(', ')}`}
          >
            <line className="ra-mid" x1={PAD} x2={W - PAD} y1={y(0.5)} y2={y(0.5)} />
            {drawn.length > 1 && <polyline className="ra-line" data-chart={colour} points={line} vectorEffect="non-scaling-stroke" />}
            {drawn.map((p, i) => (
              <circle className="ra-point" data-chart={colour} key={i} cx={p.x} cy={p.y} r={2} />
            ))}
          </svg>
        )}
      </td>
      {answers.map((answer, i) => (
        <td className="num ra-cell" key={points[i].street} title={answer?.note}>
          {answer == null ? '' : percent(answer.equity)}
        </td>
      ))}
    </tr>
  );
}
