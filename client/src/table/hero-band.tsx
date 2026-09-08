import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useReducedMotion } from 'motion/react';
import type { ActionKind, Card, LegalActions, TableView } from '@opentable/protocol';
import { PlayingCard } from './playing-card.tsx';
import { TurnBar, TurnSeconds } from './turn-clock.tsx';
import {
  HandResult, KeyLegend, PreActionPills, StopWatching, useDockLogic, useTurnKeys,
  waitingText, watchingText,
} from './dock.tsx';
import type { PreAction } from './preactions.ts';
import { clamp, presetsFor, raiseAction, raiseLabel, raiseShape } from './sizing.ts';
import type { Preset } from './sizing.ts';
import { playClick } from './sounds.ts';
import { actionText, shortName } from './labels.ts';
import { useFading, useMedia } from '../ui/bits.tsx';
import { FlagSlot } from '../ui/flag.tsx';
import './hero-band.css';

export interface HeroBandProps {
  view: TableView;
  onAct: (a: ActionKind, v?: number) => void;
  sending: boolean;
  /* The five that made the winning hand, so your own two are outlined here the
     way the felt outlines the board. The band is your seat, so it has to say
     what the seat would have said. */
  best?: ReadonlySet<Card>;
  /* Your stack, from `table.tsx` rather than out of the view, because at hand
     end it is held at what it was until the pot has actually moved. That is
     the felt's own reading of when a hand is paid, and the band is a seat on
     that felt: two readings of it would drift. */
  stack: number;
}

/* The action band, in place of the dock, at every width. Two columns: your own
   two cards drawn at the size you would hold them, with your name and your
   stack under them, and a column of controls beside them. Which side each
   takes is a setting, because a phone is held in one hand and the thumb only
   reaches one edge.

   **The band is your seat now, at every width**, so it carries what the seat
   carried: the turn clock's bar along its top edge and the seconds in a slot
   of their own beside the last action.

   The dock's rule holds here and is the reason nothing in this file measures
   itself: one box, one height, four states rendered into it. Every control is
   rendered in every state it belongs to and disabled rather than dropped, and
   every string that changes sits in a slot with a size of its own. */

/* Above this the raise control is a row of sizes under a mouse; below it, a
   sweep under a thumb. The same number the stylesheet's phone block uses. */
const WIDE = '(min-width: 561px)';

export function HeroBand({ view, onAct, sending, best, stack }: HeroBandProps) {
  const { state, pre, setPre, canPre } = useDockLogic(view, onAct, sending);
  const mine = view.you == null ? null : view.seats.find((s) => s.i === view.you) ?? null;
  const legal = view.legal;
  const wide = useMedia(WIDE);
  /* Your own clock, read the way the seat read it. Out of the flow on the
     band's top border, so it cannot move anything by starting. */
  const clock = view.clock && view.clock.seat === view.you ? view.clock : null;

  return (
    <div className="hero-band" data-state={state} data-seated={mine ? '' : undefined}>
      {/* The band's ground runs the width of the page and its content sits on
          the felt's column, so the cards start on the felt's left edge and the
          controls end on its right one. */}
      <div className="hb-in">
        {clock && (
          <TurnBar deadline={clock.deadline} totalMs={view.format.clockMs} paused={clock.paused} />
        )}

        {mine && (
          <HeroCards
            view={view}
            best={best}
            clock={clock}
            totalMs={view.format.clockMs}
            stack={stack}
          />
        )}

        {/* One quiet line under the controls, gone on a phone where there is
            no keyboard to legend. It says the same thing in every state, so it
            is rendered outside the column that changes. */}
        <KeyLegend className="hb-keys" watching={view.you == null} />

        <div className="hb-col">
          {state === 'turn' && legal ? (
            <TurnColumn view={view} legal={legal} sending={sending} onAct={onAct} wide={wide} />
          ) : state === 'over' ? (
            <OverColumn view={view} />
          ) : state === 'watch' ? (
            <WatchColumn view={view} />
          ) : (
            <WaitColumn view={view} pre={pre} onPre={setPre} canPre={canPre} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

/* Your hand, at the size the sketch asked for: two cards overlapped and fanned
   in the corner, big enough to read without looking for them, with your name,
   your stack, your last action and your clock on one edge under them. The felt
   does not draw your seat on v2 at any width (see hero-band.css) because this
   is that seat, drawn once and drawn large.

   The deal runs on the first render of a hand and not again: `still` is a
   state rather than a ref, so the flag flips after the deal has already been
   handed to motion, and the cards are keyed on the hand so a new one deals. */
function HeroCards({
  view, best, clock, totalMs, stack,
}: {
  view: TableView;
  best?: ReadonlySet<Card>;
  clock: TableView['clock'];
  totalMs: number;
  stack: number;
}) {
  const mine = view.seats.find((s) => s.i === view.you);
  const cards = mine?.cards ?? [null, null];
  const [dealtHand, setDealtHand] = useState<number | null>(null);
  useEffect(() => setDealtHand(view.h), [view.h]);
  const still = dealtHand === view.h;

  const last = mine?.last ?? null;
  const label = useFading(last ? actionText(last.a, last.v) : null, `${view.h}:${view.n}:${view.you}`);

  return (
    <div className="hb-hero">
      <div className="hb-cards">
        {[0, 1].map((i) => (
          <span
            className="hb-card"
            key={`${view.h}-${i}`}
            data-i={i}
            style={{ '--i': i } as CSSProperties}
          >
            <PlayingCard
              card={cards[i] ?? null}
              index={i}
              dim={mine?.folded}
              best={cards[i] != null && best != null && best.has(cards[i] as Card)}
              still={still}
            />
          </span>
        ))}
      </div>

      <div className="hb-meta">
        <span className="hb-who">
          {/* Reserved like the button marker beside it: an empty slot keeps
              the name where it was for a player with no flag. */}
          <FlagSlot code={mine?.country} size={16} />
          <span className="hb-name" title={mine?.name}>{shortName(mine?.name ?? '', 16)}</span>
          {/* Always rendered, hidden when the button is elsewhere: a marker
              that comes and goes moves the name beside it once a hand. */}
          <span className="btn-marker" title="Button" data-off={mine?.button ? undefined : ''}>D</span>
        </span>
        <span className="hb-nums">
          <span className="hb-stack num">{stack}</span>
          {/* A reserved slot: the label is empty most of the hand and a box
              that sizes to it would move the stack every time it filled. */}
          <span className="hb-last">{label}</span>
          {/* And another, for the same reason: the seconds arrive once a hand
              and a box that grows to hold them moves the label beside it. */}
          <span className="hb-clock">
            {clock && (
              <TurnSeconds deadline={clock.deadline} totalMs={totalMs} paused={clock.paused} />
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- turn */

function TurnColumn({
  view, legal, sending, onAct, wide,
}: {
  view: TableView;
  legal: LegalActions;
  sending: boolean;
  onAct: (a: ActionKind, v?: number) => void;
  wide: boolean;
}) {
  const { canRaise, checkOrCall } = raiseShape(legal);
  const { call, min, max } = legal;
  /* Two ways to choose a size and only ever one of them on screen: the phone
     sweeps, and a screen with a mouse presses one of the six. `custom` is the
     wide band's typed way in, and it stands in the sizes' own box. */
  const [sizing, setSizing] = useState(false);
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(min);
  const myBet = view.seats.find((s) => s.i === view.you)?.bet ?? 0;
  const presets = useMemo(
    () => (canRaise ? presetsFor(legal, view.pot, myBet, view.street) : []),
    [canRaise, legal, view.pot, myBet, view.street],
  );

  /* A fresh decision resets the size to the minimum and closes whichever way
     in was open: carrying the last one into a new spot is how people put a
     stack in by accident, and a sizer left open over a hand you have not
     looked at is the same mistake with a slider on it. */
  useEffect(() => {
    setValue(min);
    setSizing(false);
    setCustom(false);
  }, [min, max, view.h, view.n]);

  const send = useCallback((v: number) => {
    if (sending || !canRaise) return;
    const { kind, value: amount } = raiseAction(legal, v);
    if (amount == null) onAct(kind);
    else onAct(kind, amount);
  }, [sending, canRaise, legal, onAct]);

  /* The same keys the dock answers to, doing the same things. `r` reaches for
     where the size is chosen, which is the sweep on a phone and the custom
     field on a wide band. A number key addresses the preset it is written
     beside: on a phone that writes it into the sweep, and on a wide band it
     does what pressing that segment does, which is send it. */
  const openSizer = useCallback(() => {
    if (wide) setCustom(true);
    else setSizing(true);
  }, [wide]);
  const takePreset = useCallback((v: number) => {
    if (wide) { playClick(); send(v); return; }
    setValue(v);
    setSizing(true);
  }, [wide, send]);
  useTurnKeys({ legal, presets, sending, onAct, onRaiseKey: openSizer, onPresetKey: takePreset });

  if (!wide && sizing && canRaise) {
    return (
      <Sizer
        legal={legal}
        value={value}
        onValue={setValue}
        presets={presets}
        onBack={() => { playClick(); setSizing(false); }}
        onSend={() => { playClick(); send(value); }}
        sending={sending}
      />
    );
  }

  return (
    <div className="hb-turn" data-wide={wide ? '' : undefined}>
      {/* Left aligned, not centred: the numbers change every action and a
          centred line moves its own first character when they do. */}
      <div className="hb-note num">
        Pot {view.pot}
        {call > 0 ? ` · to call ${call}` : ' · nothing to call'}
      </div>

      {wide ? (
        custom && canRaise ? (
          <CustomSize
            legal={legal}
            sending={sending}
            onSend={send}
            onClose={() => setCustom(false)}
          />
        ) : (
          <SizeRow
            presets={presets}
            sending={sending}
            onSend={(v) => { playClick(); send(v); }}
            onCustom={() => { playClick(); setCustom(true); }}
          />
        )
      ) : (
        /* The phone's one raise control: a button that opens the sweep. Both
            buttons are here in every spot and the emphasis moves between them,
            the way the dock moves it. */
        <button
          type="button"
          className={canRaise ? 'btn btn-primary num hb-act' : 'btn btn-secondary num hb-act'}
          data-primary={canRaise ? '' : undefined}
          disabled={sending || !canRaise}
          onClick={() => { playClick(); openSizer(); }}
        >
          {canRaise ? raiseLabel(legal, min) : 'Raise'}
        </button>
      )}

      {/* Facing an all in there is nothing to raise to, so calling is the
          decision and it takes the primary slot. On a wide band it takes it
          either way: six sizes are six choices and none of them is the one the
          eye should land on first. */}
      <button
        type="button"
        className={!wide && canRaise ? 'btn btn-secondary num hb-act' : 'btn btn-primary num hb-act'}
        data-primary={!wide && canRaise ? undefined : ''}
        disabled={sending || checkOrCall == null}
        onClick={() => { if (checkOrCall) { playClick(); onAct(checkOrCall); } }}
      >
        {checkOrCall === 'c' ? `Call ${call}` : 'Check'}
      </button>

      <FoldBar
        disabled={sending || !legal.actions.includes('f')}
        onFold={() => onAct('f')}
      />
    </div>
  );
}

/* ------------------------------------------------------------- size row */

/* The wide band's raise control: the six presets as six equal segments, each
   printing its name over the number it will send, and a narrower seventh for
   a size that is none of them. One press sends, which is what a mouse and the
   number keys both do here, so there is no size to carry from one press to the
   next and nothing to confirm.

   The six are `presetsFor`, in its order, because the number keys address them
   by position and a preset that moves is a preset nobody learns. When raising
   is not on the table the group is empty and keeps its box: the row is a fixed
   height in the column above it, and six dead segments say less than nothing
   where there is nothing to say. */
function SizeRow({
  presets, sending, onSend, onCustom,
}: {
  presets: Preset[];
  sending: boolean;
  onSend: (v: number) => void;
  onCustom: () => void;
}) {
  return (
    <div className="hb-sizes" role="group" aria-label="Raise sizes">
      {presets.map((p, i) => (
        <button
          key={p.key}
          type="button"
          className="hb-size"
          disabled={sending}
          title={`${p.label}, key ${i + 1}`}
          onClick={() => onSend(p.value)}
        >
          <span className="s-n">{p.label}</span>
          <span className="s-v num">{p.value}</span>
        </button>
      ))}
      {presets.length > 0 && (
        <button
          type="button"
          className="hb-size hb-size-custom"
          disabled={sending}
          title="A size of your own, key R"
          onClick={onCustom}
        >
          <span className="s-n">Custom</span>
          <span className="s-v num" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* A size of your own, in the segments' own box. The field is the source of
   truth exactly as the dock's is: a number outside the legal range is clamped
   into the field and not sent, so the next press sends a number somebody
   chose. Enter sends, Escape puts the six sizes back. */
function CustomSize({
  legal, sending, onSend, onClose,
}: {
  legal: LegalActions;
  sending: boolean;
  onSend: (v: number) => void;
  onClose: () => void;
}) {
  const { min, max } = legal;
  const { isBet } = raiseShape(legal);
  const [raw, setRaw] = useState(() => String(min));
  const ref = useRef<HTMLInputElement>(null);
  const value = Number(raw);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const submit = () => {
    if (sending) return;
    const typed = Number.isFinite(value) && raw !== '' ? Math.round(value) : min;
    const fixed = clamp(typed, min, max);
    if (fixed !== typed) {
      setRaw(String(fixed));
      ref.current?.select();
      return;
    }
    playClick();
    onSend(fixed);
  };

  return (
    <div className="hb-custom">
      <label className="hb-custom-field">
        <span className="label">{isBet ? 'Bet' : 'Raise to'}</span>
        <input
          ref={ref}
          className="input num"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={raw}
          disabled={sending}
          aria-label={isBet ? 'Bet amount' : 'Raise to amount'}
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
      </label>
      <button
        type="button"
        className="btn btn-secondary num hb-custom-send"
        disabled={sending}
        onClick={submit}
      >
        {raiseLabel(legal, Number.isFinite(value) && raw !== '' ? value : min)}
      </button>
      <button type="button" className="btn btn-tertiary hb-custom-back" onClick={onClose}>
        Back
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- fold bar */

/* Fold is the one action on this band you cannot take by accident. It is a
   slide, not a tap: drag the handle seven tenths of the way across and the
   hand goes; let go before that and it springs back. A tap nudges it and
   springs back, which is how the gesture teaches itself.

   Pointer events with capture, not touch events: capture is what keeps the
   drag alive when the finger leaves the track, and it is the same code path
   for a mouse in a desktop browser emulating a phone. */
const FOLD_THRESHOLD = 0.7;
const FOLD_NUDGE = 12;

function FoldBar({ disabled, onFold }: { disabled: boolean; onFold: () => void }) {
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  /* Progress, not pixels: the handle is placed as a fraction of the room it
     has, so the same number means the same thing at any width and nothing has
     to be recomputed when the band is redrawn. */
  const [p, setP] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ from: number; moved: number } | null>(null);
  const nudge = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Measured when a drag starts and held, so the handle is moved with a
     transform rather than an offset: an offset is a layout change, and this
     control is 48 px from the felt. */
  const travel = useRef(0);

  useEffect(() => () => { if (nudge.current) clearTimeout(nudge.current); }, []);

  /* How far the handle can travel: the track less the handle and its inset. */
  const span = useCallback(() => {
    const track = trackRef.current;
    const handle = handleRef.current;
    if (!track || !handle) return 0;
    return Math.max(1, track.clientWidth - handle.offsetWidth - 8);
  }, []);

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    travel.current = span();
    drag.current = { from: e.clientX, moved: 0 };
    setDragging(true);
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const moved = e.clientX - d.from;
    d.moved = Math.max(d.moved, Math.abs(moved));
    setP(clamp(moved / Math.max(1, travel.current), 0, 1));
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (p >= FOLD_THRESHOLD) {
      setP(0);
      onFold();
      return;
    }
    /* Nothing moved, so this was a tap: shove the handle far enough to be seen
       and let it come back, rather than doing nothing and reading as broken. */
    if (d.moved < 4) {
      setP(FOLD_NUDGE / Math.max(1, travel.current));
      nudge.current = setTimeout(() => setP(0), reduced ? 0 : 160);
      return;
    }
    setP(0);
  };

  return (
    <button
      ref={trackRef}
      type="button"
      className="hb-fold"
      disabled={disabled}
      aria-label="Fold"
      data-dragging={dragging ? '' : undefined}
      data-armed={p >= FOLD_THRESHOLD ? '' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      /* A pointer press is a slide, so its click does nothing. A keyboard
         press has no pointer behind it (detail 0) and folds outright, which
         is the only way this control is reachable without a thumb. */
      onClick={(e) => { if (e.detail === 0 && !disabled) onFold(); }}
      style={{ '--dx': `${(p * travel.current).toFixed(2)}px` } as CSSProperties}
    >
      <span className="hb-fold-hatch" aria-hidden="true" />
      <span className="hb-fold-word">Fold</span>
      <span className="hb-fold-handle" ref={handleRef} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ sizer */

/* A vertical sweep up the outer edge of the screen: min at the bottom, all in
   at the top, and a press anywhere on the track jumps to that point and drags
   on from there, so a size is one thumb movement rather than a grab and a
   drag. The range input underneath is the real control for a keyboard and for
   a screen reader; everything visible is drawn here because a native slider
   cannot be swept this way. */
function Sizer({
  legal, presets, value, onValue, onBack, onSend, sending,
}: {
  legal: LegalActions;
  presets: Preset[];
  value: number;
  onValue: (v: number) => void;
  onBack: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  const { min, max } = legal;
  const { isBet } = raiseShape(legal);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  /* Enter sends, the way it does from the dock's field. It is added here
     rather than in the shared key hook because it only means anything while
     a size is open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || sending) return;
      e.preventDefault();
      onSend();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSend, sending]);

  /* Three marks, and only three: the ends of the range and the pot. A pot
     sized raise is often all in or nearly it, and two labels three pixels
     apart say less than one, so a mark that lands on one already placed is
     dropped and the ends win. */
  const ticks = useMemo(() => {
    const pot = clamp(presets.find((p) => p.key === 'pot')?.value ?? max, min, max);
    const at = (v: number) => (max === min ? 0 : (v - min) / (max - min));
    const out = [
      { key: 'allin', label: 'All in', value: max },
      { key: 'min', label: 'Min', value: min },
      { key: 'pot', label: 'Pot', value: pot },
    ];
    const kept: typeof out = [];
    for (const t of out) {
      if (kept.every((k) => Math.abs(at(k.value) - at(t.value)) > 0.08)) kept.push(t);
    }
    return kept;
  }, [presets, min, max]);

  const at = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = clamp((r.bottom - clientY) / Math.max(1, r.height), 0, 1);
    onValue(Math.round(min + t * (max - min)));
  }, [min, max, onValue]);

  const frac = (v: number) => (max === min ? 0 : (clamp(v, min, max) - min) / (max - min));

  return (
    <div className="hb-sizer" style={{ '--t': frac(value) } as CSSProperties}>
      <div className="hb-sizer-head">{isBet ? 'Bet' : 'Raise to'}</div>
      <div className="hb-amount num">{value}</div>

      <button type="button" className="btn btn-tertiary hb-back" onClick={onBack}>
        Back
      </button>

      <button
        type="button"
        className="btn btn-primary num hb-confirm"
        data-primary
        disabled={sending}
        onClick={onSend}
      >
        {raiseLabel(legal, value)}
      </button>

      <div
        className="hb-track"
        ref={trackRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          at(e.clientY);
        }}
        onPointerMove={(e) => { if (dragging.current) at(e.clientY); }}
        onPointerUp={(e) => {
          dragging.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <span className="hb-rail" aria-hidden="true">
          <span className="hb-rail-fill" />
        </span>
        {ticks.map((t) => (
          <span
            key={t.key}
            className="hb-tick"
            style={{ '--p': frac(t.value) } as CSSProperties}
            aria-hidden="true"
          >
            {t.label}
          </span>
        ))}
        <span className="hb-thumb" aria-hidden="true" />
        <input
          className="hb-range"
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={sending}
          aria-label={isBet ? 'Bet size' : 'Raise to'}
          onChange={(e) => onValue(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- wait */

function WaitColumn({
  view, pre, onPre, canPre,
}: {
  view: TableView;
  pre: PreAction | null;
  onPre: (p: PreAction | null) => void;
  canPre: boolean;
}) {
  return (
    <div className="hb-wait">
      <PreActionPills pre={pre} onPre={onPre} canPre={canPre} className="hb-pre" size="" />
      <div className="hb-status">{waitingText(view)}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- over */

function OverColumn({ view }: { view: TableView }) {
  return (
    <div className="hb-over">
      <HandResult view={view} />
      {view.you == null ? (
        <StopWatching />
      ) : (
        /* The three choices held open as outlines, so the column is the same
           height while the hand settles and the eye keeps its place. */
        <div className="hb-ghosts" aria-hidden="true">
          <span className="btn btn-primary ghost" data-primary>Raise</span>
          <span className="btn btn-secondary ghost">Check</span>
          <span className="btn btn-tertiary ghost">Fold</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ watch */

function WatchColumn({ view }: { view: TableView }) {
  return (
    <div className="hb-watch">
      <div className="hb-status">{watchingText(view)}</div>
      <StopWatching />
    </div>
  );
}
