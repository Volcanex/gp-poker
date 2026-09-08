/* The range explorer: paint a range on the grid, read it back as notation, and
   see how a hand runs against it.

   The grid and the notation field are two views of one Set of hand classes, so
   either can be edited and the other follows. Equity goes through the analysis
   worker; nothing on this page evaluates a hand on the main thread, which is
   why painting stays smooth while a preflop sample of twenty thousand deals is
   running underneath. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  comboCount,
  parseRange,
  rangeFromTop,
  rangePercent,
  rangeToText,
  type Range,
} from '@opentable/equity/range';
import { chartPresets } from '@opentable/equity/presets';
import { percentileOf } from '@opentable/preflop';
import type { EquityResult } from '@opentable/equity';
import { analyse, cancel, isCancelled, nextRequestId } from '../analysis/index.ts';
import { useGInit } from '../ui/bits.tsx';
import { useTitle } from '../ui/title.ts';
import { BoardText } from '../ui/board-text.tsx';
import { CardPicker, readCards } from './cards.tsx';
import { HandGrid } from './hand-grid.tsx';
import { FlatLegend, GridLegend } from './grid-legend.tsx';
import { rampFill, rampHue, rangeHeat } from './ramp.ts';

const PRESETS = chartPresets();
const START_PERCENT = 20;

export function Ranges() {
  /* ?preset=deep/sb_open opens straight on one of the baseline charts, which
     is how the opening explorer hands over a spot: same position, the chart
     beside what people actually did with it. An id nothing matches is simply
     the page as it always opens. */
  const [params] = useSearchParams();
  const asked = PRESETS.find((p) => p.id === params.get('preset')) ?? null;
  const [range, setRange] = useState<Range>(() => (asked ? asked.range : rangeFromTop(START_PERCENT)));
  /* The notation field shows the canonical text of the range, except while it
     is being typed into: a draft that parses updates the range, and letting the
     field snap to canonical form mid-word would fight the typist. */
  const [draft, setDraft] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [top, setTop] = useState(asked ? Math.round(asked.percent) : START_PERCENT);
  /* Two ways of reading the same selection. A range that came off the slider is
     an ordering, so it is worth shading by where each hand sits in it; a chart
     or a painted range is a set, where a second colour would claim a ranking
     the range does not have. */
  const [heat, setHeat] = useState(!asked);
  const [preset, setPreset] = useState(asked ? asked.id : '');
  const [hero, setHero] = useState<[string, string]>(['Ah', 'Ks']);
  const [boardText, setBoardText] = useState('');
  const sliderRef = useRef<HTMLDivElement | null>(null);
  useGInit(sliderRef);
  useTitle('Range explorer');

  const board = readCards(boardText);
  const boardError = board === null || board.length > 5;

  const text = draft ?? rangeToText(range);

  /* Every wholesale change to the range comes through here. The grid's centre-out
     entrance is for opening the page, not for every edit, so nothing here
     re-triggers it: painting, typing, the slider and the presets all update the
     cells in place, which is what makes dragging the slider read as scrubbing
     rather than as the grid restarting under the pointer. */
  const apply = (next: Range, shaded: boolean) => {
    setRange(next);
    setHeat(shaded);
    setDraft(null);
    setTextError(null);
  };

  const paint = (cls: string, adding: boolean) => {
    setPreset('');
    setHeat(false);
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
    setHeat(false);
    try {
      setRange(parseRange(value));
      setTextError(null);
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'That is not a range');
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
          <HandGrid
            label="Starting hands"
            cell={(cls) => cellFor(cls, range.has(cls), heat, top)}
            onPaint={paint}
            hint="Click or drag to paint. Arrow keys move, space toggles. Pairs run down the diagonal, suited above it, offsuit below."
          />
          {heat ? (
            <GridLegend
              from={`Top ${top}%`}
              to="Top 1%"
              note="Shaded by how early a hand enters the range."
            />
          ) : (
            <FlatLegend
              label="In the range"
              note="A chart or a painted range is a set, not an order."
            />
          )}
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
                    apply(rangeFromTop(value), true);
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
                      apply(found.range, false);
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
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(new Set(), false)}>
                Clear the range
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setTop(100);
                  apply(rangeFromTop(100), true);
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

/* A cell in the heat view carries where its hand sits in the slice, not what
   kind of hand it is: the pair, suited and offsuit tiering underneath is the
   grid's own furniture and stays out of the ramp. */
function cellFor(cls: string, on: boolean, heat: boolean, top: number) {
  if (!on || !heat) return { content: cls, label: cls, selected: on };
  const percentile = percentileOf(cls);
  const t = rangeHeat(percentile, top);
  return {
    content: cls,
    label: `${cls}, in the top ${Math.max(1, Math.ceil(percentile))}% of hands`,
    selected: true,
    tone: 'heat',
    style: { '--_f': rampFill(t), '--_h': rampHue(t) } as React.CSSProperties,
  };
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
    ? `Exact, all ${result.samples.toLocaleString('en-GB')} deals`
    : `Sampled, ${result.samples.toLocaleString('en-GB')} deals`;
}
