/* The range explorer: paint a range on the grid, read it back as notation, and
   see how a hand runs against it.

   The grid and the notation field are two views of one Set of hand classes, so
   either can be edited and the other follows. Equity goes through the analysis
   worker; nothing on this page evaluates a hand on the main thread, which is
   why painting stays smooth while a preflop sample of twenty thousand deals is
   running underneath. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  classKind,
  comboCount,
  HAND_GRID,
  parseRange,
  rangeFromTop,
  rangePercent,
  rangeToText,
  type Range,
} from '@opentable/equity/range';
import { chartPresets } from '@opentable/equity/presets';
import type { EquityResult } from '@opentable/equity';
import { analyse, cancel, isCancelled, nextRequestId } from '../analysis/index.ts';
import { useGInit } from '../ui/bits.tsx';
import { useTitle } from '../ui/title.ts';
import { BoardText } from '../ui/board-text.tsx';
import { CardPicker, readCards } from './cards.tsx';

const PRESETS = chartPresets();
const START_PERCENT = 20;

export function Ranges() {
  const [range, setRange] = useState<Range>(() => rangeFromTop(START_PERCENT));
  /* The notation field shows the canonical text of the range, except while it
     is being typed into: a draft that parses updates the range, and letting the
     field snap to canonical form mid-word would fight the typist. */
  const [draft, setDraft] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [top, setTop] = useState(START_PERCENT);
  const [preset, setPreset] = useState('');
  const [hero, setHero] = useState<[string, string]>(['Ah', 'Ks']);
  const [boardText, setBoardText] = useState('');
  const sliderRef = useRef<HTMLDivElement | null>(null);
  useGInit(sliderRef);
  useTitle('Range explorer');

  const board = readCards(boardText);
  const boardError = board === null || board.length > 5;

  const text = draft ?? rangeToText(range);

  const apply = (next: Range) => {
    setRange(next);
    setDraft(null);
    setTextError(null);
  };

  const paint = (cls: string, adding: boolean) => {
    setPreset('');
    setDraft(null);
    setTextError(null);
    setRange((prev) => {
      const next = new Set(prev);
      if (adding) next.add(cls);
      else next.delete(cls);
      return next;
    });
  };

  const onText = (value: string) => {
    setDraft(value);
    setPreset('');
    try {
      setRange(parseRange(value));
      setTextError(null);
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'that is not a range');
    }
  };

  const combos = comboCount(range);
  const percent = rangePercent(range);

  return (
    <main className="page wide stack tools-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Range explorer</h1>
        <p className="muted">
          Paint a range on the grid or type it in notation, then run a hand against it. The presets
          are the baseline heads-up charts the accuracy score grades against, explained in{' '}
          <Link to="/learn/ranges">the ranges lesson</Link>. For the maths on a single spot, use the{' '}
          <Link to="/tools/odds">pot odds trainer</Link>.
        </p>
      </div>

      <div className="tools-split">
        <section className="card stack" aria-label="The range">
          <HandGrid range={range} onPaint={paint} />
          <div className="range-meta">
            <span className="num">{combos}</span>
            <span className="muted">combos</span>
            <span className="num">{percent.toFixed(1)}%</span>
            <span className="muted">of hands</span>
          </div>
        </section>

        <div className="stack">
          <section className="card stack" aria-label="Range controls">
            <div className="field">
              <label className="label" htmlFor="notation">Notation</label>
              <input
                id="notation"
                className="input"
                value={text}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={textError ? true : undefined}
                onChange={(e) => onText(e.target.value)}
                onBlur={() => setDraft(null)}
              />
              {textError ? (
                <span className="field-note error">{textError}. The grid still holds the last range that read.</span>
              ) : (
                <span className="field-note muted">Commas or spaces. "22+, AQo+, A2s+, T9s-65s".</span>
              )}
            </div>

            <div className="field" ref={sliderRef}>
              <label className="label" htmlFor="top">Top hands, by equity ranking</label>
              <span className="g-slider" data-output data-suffix="%">
                <input
                  id="top"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={top}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setTop(value);
                    setPreset('');
                    apply(rangeFromTop(value));
                  }}
                />
              </span>
              <span className="field-note muted">
                By class on the equity ranking, so it moves in steps of one of the 169 hands.
              </span>
            </div>

            <div className="field">
              <label className="label" htmlFor="preset">Baseline charts</label>
              <span className="select-wrap">
                <select
                  id="preset"
                  className="select"
                  value={preset}
                  onChange={(e) => {
                    const found = PRESETS.find((p) => p.id === e.target.value);
                    setPreset(e.target.value);
                    if (found) {
                      setTop(Math.round(found.percent));
                      apply(found.range);
                    }
                  }}
                >
                  <option value="">Pick a spot</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </span>
              <span className="field-note muted">
                Heuristic baselines, not solver output. They are a rough signal, not a target.
              </span>
            </div>

            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(new Set())}>
                Clear the range
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setTop(100);
                  apply(rangeFromTop(100));
                }}
              >
                Select every hand
              </button>
            </div>
          </section>

          <EquityPanel hero={hero} onHero={setHero} board={board ?? []} boardText={boardText} onBoardText={setBoardText} boardError={boardError} range={range} />
        </div>
      </div>
    </main>
  );
}

function HandGrid({ range, onPaint }: { range: Range; onPaint: (cls: string, adding: boolean) => void }) {
  const painting = useRef<boolean | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    const stop = () => {
      painting.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const move = (row: number, col: number) => {
    const r = Math.max(0, Math.min(12, row));
    const c = Math.max(0, Math.min(12, col));
    setFocus([r, c]);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const [r, c] = focus;
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(r - 1, c),
      ArrowDown: () => move(r + 1, c),
      ArrowLeft: () => move(r, c - 1),
      ArrowRight: () => move(r, c + 1),
      Home: () => move(r, 0),
      End: () => move(r, 12),
    };
    const handler = keys[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  return (
    <div className="grid-wrap">
      <div
        className="hand-grid"
        role="grid"
        aria-label="Starting hands"
        aria-multiselectable="true"
        ref={gridRef}
        onKeyDown={onKeyDown}
      >
        {HAND_GRID.map((row, r) => (
          <div className="grid-row" role="row" key={r}>
            {row.map((cls, c) => {
              const on = range.has(cls);
              return (
                <button
                  key={cls}
                  type="button"
                  role="gridcell"
                  data-r={r}
                  data-c={c}
                  data-kind={classKind(cls)}
                  className="cell"
                  aria-selected={on}
                  aria-label={cls}
                  tabIndex={focus[0] === r && focus[1] === c ? 0 : -1}
                  onFocus={() => setFocus([r, c])}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    painting.current = !on;
                    onPaint(cls, !on);
                  }}
                  onPointerEnter={() => {
                    if (painting.current !== null) onPaint(cls, painting.current);
                  }}
                  onClick={(e) => {
                    // A pointer already painted this cell; only the keyboard
                    // should toggle it a second time.
                    if (e.detail !== 0) return;
                    onPaint(cls, !on);
                  }}
                >
                  {cls}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="muted grid-hint">
        Click or drag to paint. Arrow keys move, space toggles. Pairs run down the diagonal, suited
        above it, offsuit below.
      </p>
    </div>
  );
}

function EquityPanel({
  hero,
  onHero,
  board,
  boardText,
  onBoardText,
  boardError,
  range,
}: {
  hero: [string, string];
  onHero: (hero: [string, string]) => void;
  board: string[];
  boardText: string;
  onBoardText: (text: string) => void;
  boardError: boolean;
  range: Range;
}) {
  const [vsRange, setVsRange] = useState<EquityResult | null>(null);
  const [vsRandom, setVsRandom] = useState<EquityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const text = useMemo(() => rangeToText(range), [range]);
  const twice = [...hero, ...board].filter((card, i, all) => all.indexOf(card) !== i);
  const ready = !boardError && twice.length === 0 && range.size > 0;
  const key = `${hero.join('')}|${board.join('')}|${text}`;

  useEffect(() => {
    if (!ready) {
      setVsRange(null);
      setVsRandom(null);
      return;
    }
    const ids = [nextRequestId('r'), nextRequestId('x')];
    let live = true;
    setBusy(true);
    setError(null);
    // Painting fires a change per cell, so the worker is only asked once the
    // hand has settled.
    const timer = setTimeout(() => {
      Promise.all([
        analyse({ id: ids[0], hero, board, villains: [range] }).then((r) => live && setVsRange(r)),
        analyse({ id: ids[1], hero, board, villains: ['random'] }).then((r) => live && setVsRandom(r)),
      ])
        .catch((err) => {
          if (!live || isCancelled(err)) return;
          setError(err instanceof Error ? err.message : String(err));
          setVsRange(null);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
      for (const id of ids) cancel(id);
    };
  }, [key, ready]);

  return (
    <section className="card stack" aria-label="Equity" aria-busy={busy}>
      <span className="card-title">Run a hand against it</span>

      <div className="field">
        <span className="label">Your hand</span>
        <div className="row">
          <CardPicker label="First card" value={hero[0]} onChange={(c) => onHero([c, hero[1]])} />
          <CardPicker label="Second card" value={hero[1]} onChange={(c) => onHero([hero[0], c])} />
        </div>
        {twice.length > 0 && (
          <span className="field-note error">
            {twice[0]} is in play twice. Change your hand or the board.
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="board">Board, if any</label>
        <input
          id="board"
          className="input"
          value={boardText}
          placeholder="Ah Kd 2c"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={boardError ? true : undefined}
          onChange={(e) => onBoardText(e.target.value)}
        />
        {boardError ? (
          <span className="field-note error">Up to five cards, like "Ah Kd 2c".</span>
        ) : board.length > 0 ? (
          <span className="field-note"><BoardText cards={board} /></span>
        ) : (
          <span className="field-note muted">Leave it empty for a preflop matchup.</span>
        )}
      </div>

      {error ? (
        <div className="empty">
          <span className="e-title">That matchup cannot be dealt</span>
          <span className="e-desc">{error}.</span>
        </div>
      ) : (
        <dl className="results">
          <div>
            <dt>Against this range</dt>
            <dd className="num">{vsRange ? `${(vsRange.equity * 100).toFixed(1)}%` : '…'}</dd>
            <dd className="muted small">{note(vsRange, ready, range.size)}</dd>
          </div>
          <div>
            <dt>Against a random hand</dt>
            <dd className="num">{vsRandom ? `${(vsRandom.equity * 100).toFixed(1)}%` : '…'}</dd>
            <dd className="muted small">{note(vsRandom, ready, range.size)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function note(result: EquityResult | null, ready: boolean, size: number): string {
  if (!ready) return size === 0 ? 'Pick at least one hand' : 'Fix the cards above';
  if (!result) return 'Computing';
  return result.exact
    ? `exact, all ${result.samples.toLocaleString('en-GB')} deals`
    : `sampled, ${result.samples.toLocaleString('en-GB')} deals`;
}
