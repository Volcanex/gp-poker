/* The opening explorer: what players on this site actually did preflop, laid
   over the 13 by 13 grid. Lichess's opening book, for a poker table.

   It is a record, not advice. Every number on this page is what the people and
   bots here did with a hand, which is a different thing from what they should
   have done, and the page says so rather than leaving a reader to assume the
   grid is a chart. The link to the range explorer is there for exactly that
   comparison: the baseline chart beside what happened.

   All the arithmetic is the server's (server/src/explorer.ts). This page picks
   the selection, shades the grid and reads one cell out at a time. */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Mode } from '@opentable/protocol';
import { api } from '../net/api.ts';
import type { Explorer, ExplorerFacing, ExplorerPlayers, ExplorerRow, PositionKey } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { useTitle } from '../ui/title.ts';
import { MODE_NAME, ModeTabs } from '../ui/mode-tabs.tsx';
import { fmtDate } from '../ui/format.ts';
import { HandGrid, type HandCell } from './hand-grid.tsx';
import { GridLegend } from './grid-legend.tsx';
import { DIVERGE_CAP, rampFill, rampHue } from './ramp.ts';

/* The positions each mode can produce, in seating order from the button, and
   named the way a player would say them. The keys are the server's, which are
   the same ones a profile's insights use, so the two pages cannot disagree
   about what "cutoff" means. */
const POSITIONS: Record<Mode, { key: PositionKey; label: string }[]> = {
  'heads-up': [
    { key: 'button', label: 'Small blind, on the button' },
    { key: 'big-blind', label: 'Big blind' },
  ],
  'six-max': [
    { key: 'button', label: 'Button' },
    { key: 'small-blind', label: 'Small blind' },
    { key: 'big-blind', label: 'Big blind' },
    { key: 'utg', label: 'Under the gun' },
    { key: 'hijack', label: 'Hijack' },
    { key: 'cutoff', label: 'Cutoff' },
  ],
};

const FACINGS: { key: ExplorerFacing; label: string }[] = [
  { key: 'unopened', label: 'Nobody has raised' },
  { key: 'open', label: 'Facing an open' },
  { key: 'threebet', label: 'Facing a three-bet' },
];

const PLAYERS: { key: ExplorerPlayers; label: string }[] = [
  { key: 'all', label: 'Everyone, bots included' },
  { key: 'humans', label: 'People only' },
];

type Shade = 'raise' | 'netBb';

const SHADES: { key: Shade; label: string }[] = [
  { key: 'raise', label: 'How often it was raised' },
  { key: 'netBb', label: 'Big blinds won per hand' },
];

/* The baseline chart that answers the same question as a selection, where one
   exists. Only heads-up has charts, and only for the four spots the accuracy
   score grades; a limped pot and the button facing a raise it opened into are
   both real spots with no baseline to compare against. Every match here is
   200 units at 1/2, so the stack bucket is always the deep one. */
const PRESETS: Partial<Record<string, string>> = {
  'button|unopened': 'deep/sb_open',
  'big-blind|open': 'deep/bb_vs_open',
  'button|threebet': 'deep/sb_vs_3bet',
  'big-blind|threebet': 'deep/bb_vs_4bet',
};

export function Explorer() {
  const { queue } = useSession();
  const [mode, setMode] = useState<Mode>(queue.mode);
  const [position, setPosition] = useState<PositionKey>('button');
  const [facing, setFacing] = useState<ExplorerFacing>('unopened');
  const [players, setPlayers] = useState<ExplorerPlayers>('all');
  const [shade, setShade] = useState<Shade>('raise');
  const [book, setBook] = useState<Explorer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  useTitle('Opening explorer');

  /* Switching mode can leave a position the new mode does not have, so the
     selection falls back to the button rather than asking for a seat that is
     not at the table. */
  const seats = POSITIONS[mode];
  useEffect(() => {
    if (!seats.some((p) => p.key === position)) setPosition('button');
  }, [mode, position, seats]);

  useEffect(() => {
    let live = true;
    setBook(null);
    setError(null);
    api
      .explorer(mode, position, facing, players)
      .then((b) => live && setBook(b))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [mode, position, facing, players]);

  const rows = useMemo(() => {
    const map = new Map<string, ExplorerRow>();
    for (const row of book?.hands ?? []) map.set(row.hand, row);
    return map;
  }, [book]);

  const enough = book !== null && book.sample.hands >= book.minHands;
  const preset = mode === 'heads-up' ? PRESETS[`${position}|${facing}`] : undefined;
  const seatLabel = seats.find((p) => p.key === position)?.label ?? 'Button';

  return (
    <main className="page wide stack tools-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Opening explorer</h1>
        <p className="muted">
          Every hand ever played here, read back as a book: from one seat, in one situation, what
          the table did with each of the 169 starting hands and how it went. This is a record of
          what people on this site did, not a chart of what to do. For the baseline charts, open
          the <Link to="/tools/ranges">range explorer</Link>, and for why they look the way they do
          read <Link to="/learn/ranges">the ranges lesson</Link>.
        </p>
        <ModeTabs mode={mode} onPick={setMode} label="Explorer mode" />
      </div>

      <section className="card ex-controls" aria-label="Selection">
        <div className="field">
          <label className="label" htmlFor="ex-position">Seat</label>
          <span className="select-wrap">
            <select
              id="ex-position"
              className="select"
              value={position}
              onChange={(e) => setPosition(e.target.value as PositionKey)}
            >
              {seats.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </span>
        </div>

        <div className="field">
          <label className="label" htmlFor="ex-facing">Situation</label>
          <span className="select-wrap">
            <select
              id="ex-facing"
              className="select"
              value={facing}
              onChange={(e) => setFacing(e.target.value as ExplorerFacing)}
            >
              {FACINGS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </span>
        </div>

        <div className="field">
          <label className="label" htmlFor="ex-players">Players</label>
          <span className="select-wrap">
            <select
              id="ex-players"
              className="select"
              value={players}
              onChange={(e) => setPlayers(e.target.value as ExplorerPlayers)}
            >
              {PLAYERS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </span>
        </div>

        <div className="field">
          <label className="label" htmlFor="ex-shade">Shade by</label>
          <span className="select-wrap">
            <select
              id="ex-shade"
              className="select"
              value={shade}
              onChange={(e) => setShade(e.target.value as Shade)}
            >
              {SHADES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </span>
        </div>
      </section>

      {error ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">The book did not load</span>
            <span className="e-desc">{error}. Reload to try again.</span>
          </div>
        </div>
      ) : book === null ? (
        <div className="card" aria-busy="true">
          <div className="empty">
            <span className="e-title">Reading the book</span>
            <span className="e-desc">Every finished {MODE_NAME[mode].toLowerCase()} hand, replayed.</span>
          </div>
        </div>
      ) : !enough ? (
        <div className="card">
          <div className="empty">
            <span className="e-title">Not enough hands here yet</span>
            <span className="e-desc">
              {book.sample.hands === 0
                ? 'Nobody has played this spot.'
                : `${book.sample.hands} of the ${book.minHands} it takes to be worth reading.`}{' '}
              Play some and come back.
            </span>
          </div>
        </div>
      ) : (
        <>
          <p className="ex-sample">
            <span className="num">{book.sample.hands.toLocaleString('en-GB')}</span> hands here
            {book.since ? <> since {fmtDate(book.since)}</> : null}, from{' '}
            <span className="num">{book.sample.matches.toLocaleString('en-GB')}</span>{' '}
            {book.sample.matches === 1 ? 'match' : 'matches'}.
          </p>

          <div className="tools-split">
            <section className="card stack" aria-label="The book">
              <HandGrid
                label={`${seatLabel}, ${FACINGS.find((f) => f.key === facing)?.label.toLowerCase()}`}
                cell={(cls) => cellFor(rows.get(cls), cls, shade)}
                onShow={setShowing}
                ranks
                wave={`${mode}|${position}|${facing}|${players}|${shade}`}
                hint={
                  shade === 'raise'
                    ? 'Shaded by how often the hand was raised. The number is the most common action. Hover or tab a cell for the whole breakdown.'
                    : 'Shaded green where the hand won big blinds and red where it lost them. The number is the most common action.'
                }
              />
              <Legend shade={shade} />
            </section>

            <div className="stack">
              <Breakdown row={showing ? (rows.get(showing) ?? null) : null} seat={seatLabel} />

              <section className="card stack" aria-label="Every hand in this spot">
                <span className="card-title">All of them together</span>
                <Rates row={book.totals} />
                {preset ? (
                  <Link className="btn btn-secondary btn-sm" to={`/tools/ranges?preset=${encodeURIComponent(preset)}`}>
                    Compare with the baseline chart
                  </Link>
                ) : (
                  <span className="field-note muted">
                    There is no baseline chart for this spot, so there is nothing to compare it
                    against.
                  </span>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/* Where the big blind scale tops out. Two big blinds a hand either way is an
   enormous edge, and letting one freak cell set the scale would flatten every
   other one to nothing. */
const BB_CAP = 2;

/* A cell is a value on a ramp, never a colour of its own. How often a hand was
   raised runs up the sequential ramp, cool to hot; big blinds won runs out from
   the surface towards green or red depending on its sign. Neither ramp encodes
   whether the hand is a pair, suited or offsuit: the tiering the range explorer
   uses for that would read here as a second, contradicting variable. */
function cellFor(row: ExplorerRow | undefined, cls: string, shade: Shade): HandCell {
  const hands = row?.hands ?? 0;
  if (hands === 0) {
    return { content: '', label: `${cls}, no hands`, tone: 'none' };
  }

  const best = dominant(row!);
  const heat = shade === 'raise' ? (row!.raise ?? 0) / 100 : Math.min(Math.abs(row!.netBb ?? 0) / BB_CAP, 1);
  const tone = shade === 'raise' ? 'heat' : (row!.netBb ?? 0) >= 0 ? 'up' : 'down';

  return {
    content: <span className="num">{Math.round(best.value)}</span>,
    label: `${cls}, ${hands} ${hands === 1 ? 'hand' : 'hands'}, ${Math.round(best.value)}% ${best.word}, ${fmtBb(row!.netBb)} big blinds a hand`,
    tone,
    style: {
      '--_f': rampFill(heat, shade === 'raise' ? undefined : DIVERGE_CAP),
      '--_h': rampHue(heat),
    } as React.CSSProperties,
  };
}

function dominant(row: ExplorerRow): { word: string; value: number } {
  const options = [
    { word: 'raised', value: row.raise ?? 0 },
    { word: 'called', value: row.call ?? 0 },
    { word: 'folded', value: row.fold ?? 0 },
  ];
  return options.reduce((best, option) => (option.value > best.value ? option : best));
}

function Legend({ shade }: { shade: Shade }) {
  return shade === 'raise' ? (
    <GridLegend from="Raised 0%" to="Raised 100%" note="A cell left at the surface was never raised." />
  ) : (
    <GridLegend
      from={`Lost ${BB_CAP} bb`}
      to={`Won ${BB_CAP} bb`}
      tones={['down', 'up']}
      cap={DIVERGE_CAP}
      note="The middle of the ramp is breaking even."
    />
  );
}

function Breakdown({ row, seat }: { row: ExplorerRow | null; seat: string }) {
  return (
    <section className="card stack" aria-label="One hand" aria-live="polite">
      <span className="card-title">{row ? row.hand : 'Pick a hand'}</span>
      {row === null ? (
        <span className="muted">
          Hover a cell or tab into the grid. The seat is the {seat.toLowerCase()}.
        </span>
      ) : row.hands === 0 ? (
        <span className="muted">Nobody has been dealt {row.hand} in this spot yet.</span>
      ) : (
        <>
          <Rates row={row} />
          <span className="field-note muted">
            From {row.hands} {row.hands === 1 ? 'time' : 'times'} it came up here.
          </span>
        </>
      )}
    </section>
  );
}

function Rates({ row }: { row: Omit<ExplorerRow, 'hand'> }) {
  return (
    <>
      <dl className="results">
        <div>
          <dt>Raised</dt>
          <dd className="num">{fmtRate(row.raise)}</dd>
        </div>
        <div>
          <dt>Called</dt>
          <dd className="num">{fmtRate(row.call)}</dd>
        </div>
        <div>
          <dt>Folded</dt>
          <dd className="num">{fmtRate(row.fold)}</dd>
        </div>
        <div>
          <dt>Big blinds a hand</dt>
          <dd className="num" data-sign={sign(row.netBb)}>{fmtBb(row.netBb)}</dd>
        </div>
      </dl>
      <span className="field-note muted">
        A check counts as a call: both are the passive answer to the same question.
      </span>
    </>
  );
}

function fmtRate(n: number | null): string {
  return n === null ? '—' : `${Math.round(n)}%`;
}

function fmtBb(n: number | null): string {
  if (n === null) return '—';
  return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}

function sign(n: number | null): string | undefined {
  if (n === null || n === 0) return undefined;
  return n > 0 ? 'up' : 'down';
}
