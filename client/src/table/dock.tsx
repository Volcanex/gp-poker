import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ActionKind, LegalActions, TableView } from '@opentable/protocol';
import { holdFor } from '@opentable/protocol';
import { isTextEntry, useGInit } from '../ui/bits.tsx';
import { clamp, presetsFor, raiseAction, raiseShape } from './sizing.ts';
import type { Preset } from './sizing.ts';
import {
  PRE_ACTIONS, amountToCall, isLastHand, resolvePreAction, survivesRaise,
} from './preactions.ts';
import type { PreAction } from './preactions.ts';
import { ordinal } from './labels.ts';
import { Link } from 'react-router-dom';
import { playClick } from './sounds.ts';

export interface DockProps {
  view: TableView;
  onAct: (a: ActionKind, v?: number) => void;
  sending: boolean;
}

export type DockState = 'wait' | 'turn' | 'over' | 'watch';

export interface DockLogic {
  state: DockState;
  pre: PreAction | null;
  setPre: (p: PreAction | null) => void;
  canPre: boolean;
}

/* Which of the four states the hand is in, and the pre-action that is armed
   for it. Lifted out of the dock because the phone's hero band is a second
   rendering of the same decision: two copies of "arm a pill, fire it the
   instant the action reaches you" would drift the first time either changed. */
export function useDockLogic(view: TableView, onAct: DockProps['onAct'], sending: boolean): DockLogic {
  const legal = view.legal;
  const seated = view.you != null;
  const yourTurn = legal != null && seated;
  const over = view.street === 'done';
  /* Watching is a fourth state in the same box, not a disabled version of the
     first one: a spectator has no pre-action to arm and no seat to be waited
     for, so offering them dead pills says less than saying what they are. The
     hand still ends the way it does for a player, which is the whole reason to
     be here. */
  const state: DockState = yourTurn ? 'turn' : over ? 'over' : seated ? 'wait' : 'watch';

  const [pre, setPre] = useState<PreAction | null>(null);
  const toCall = amountToCall(view);
  const lastCall = useRef(toCall);
  const fired = useRef<string | null>(null);

  /* A pill that assumed a price is void once the price moves. */
  useEffect(() => {
    if (lastCall.current !== toCall) {
      lastCall.current = toCall;
      setPre((p) => (p != null && !survivesRaise(p) ? null : p));
    }
  }, [toCall]);

  /* The pill fires the instant the action reaches you, once per decision. */
  useEffect(() => {
    if (!yourTurn || !legal || pre == null || sending) return;
    const key = `${view.h}:${view.n}`;
    if (fired.current === key) return;
    fired.current = key;
    const a = resolvePreAction(pre, legal);
    setPre(null);
    if (a) onAct(a);
  }, [yourTurn, legal, pre, sending, view.h, view.n, onAct]);

  const mine = view.you == null ? null : view.seats.find((s) => s.i === view.you) ?? null;
  const canPre = seated && mine != null && !mine.folded && !mine.out && !mine.allin;

  return { state, pre, setPre, canPre };
}

/* The dock is the hand. One region at the bottom of the table, one fixed
   height, three states rendered in the same box: waiting, your turn, hand
   over. Nothing here mounts or unmounts the box itself, which is the whole
   point: the old action bar appeared only on your turn and the felt above it
   re-divided the moment it did. Contents cross-fade; nothing slides. */
export function Dock({ view, onAct, sending }: DockProps) {
  const legal = view.legal;
  const { state, pre, setPre, canPre } = useDockLogic(view, onAct, sending);

  return (
    <div className="dock" data-state={state}>
      <AnimatePresence mode="wait" initial={false}>
        <Fade key={state} state={state}>
          {state === 'turn' && legal ? (
            <TurnControls view={view} legal={legal} sending={sending} onAct={onAct} />
          ) : state === 'over' ? (
            <HandOver view={view} />
          ) : state === 'watch' ? (
            <Watching view={view} />
          ) : (
            <Waiting view={view} pre={pre} onPre={setPre} canPre={canPre} />
          )}
        </Fade>
      </AnimatePresence>
    </div>
  );
}

/* The state goes on the fading element, not on the dock around it. The dock's
   own attribute changes the instant the view does, while this child is still
   on screen finishing its exit: with the rules keyed to the parent, the
   outgoing content spent 120 ms laid out under the incoming state's grid, and
   that alone was the last layout shift left on the screen. */
function Fade({ children, state }: { children: ReactNode; state: DockState }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="dock-in"
      data-state={state}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: reduced ? 1 : 0 }}
      transition={{ duration: 0.12, ease: 'linear' }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ waiting */

function Waiting({
  view, pre, onPre, canPre,
}: {
  view: TableView;
  pre: PreAction | null;
  onPre: (p: PreAction | null) => void;
  canPre: boolean;
}) {
  return (
    <>
      <PreActionPills pre={pre} onPre={onPre} canPre={canPre} className="dock-pre" />
      <div className="dock-status">{waitingText(view)}</div>
    </>
  );
}

/* The three pills, in one place. The dock lays them in a row and the phone's
   hero band stacks them up the thumb's column; what they do is the same. */
export function PreActionPills({
  pre, onPre, canPre, className, size = 'btn-sm',
}: {
  pre: PreAction | null;
  onPre: (p: PreAction | null) => void;
  canPre: boolean;
  className: string;
  size?: string;
}) {
  return (
    <div className={className} role="group" aria-label="Pre-actions">
      {PRE_ACTIONS.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`btn btn-tertiary ${size} pill`}
          disabled={!canPre}
          aria-pressed={pre === p.key}
          data-on={pre === p.key ? '' : undefined}
          onClick={() => { playClick(); onPre(pre === p.key ? null : p.key); }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function waitingText(view: TableView): string {
  const mine = view.seats.find((s) => s.i === view.you);
  if (mine?.out) {
    return mine.place == null
      ? 'You are out. The table plays on.'
      : `You finished ${ordinal(mine.place)}. The table plays on.`;
  }
  const acting = view.seats.find((s) => s.acting);
  if (acting && acting.i !== view.you) return `Waiting for ${acting.name}`;
  return 'Waiting for the next card';
}

/* ----------------------------------------------------------------- watching */

/* The same box the players' controls live in, and the only control a spectator
   has, which is the way out. Two rows like the waiting state, so the dock is
   one height in every state a spectator can see it in. Who is at the table is
   said once, in the strip above the felt, not again here. */
function Watching({ view }: { view: TableView }) {
  return (
    <>
      <div className="dock-status">{watchingText(view)}</div>
      <StopWatching />
    </>
  );
}

/* Seat order, which is the order the felt reads in. "and" rather than a bare
   list, because heads-up is two names and should read as a sentence. */
export function playerList(view: TableView): string {
  const names = view.seats.map((s) => s.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function watchingText(view: TableView): string {
  const acting = view.seats.find((s) => s.acting);
  if (acting) return `${acting.name} is to act`;
  return 'Waiting for the next card';
}

/* ----------------------------------------------------------------- hand over */

/* Who won what, and how long the hand is held for. Its own component because
   the phone's hero band shows the same two things in a column half the width,
   and the countdown's length has to come off `holdFor` in both. */
export function HandResult({ view }: { view: TableView }) {
  const hold = holdFor(view.format);
  const left = useCountdown(`${view.m}:${view.h}`, hold);
  const last = isLastHand(view);
  const awards = view.result?.awards ?? [];
  const name = (seat: number) => view.seats.find((s) => s.i === seat)?.name ?? `Seat ${seat}`;

  return (
    <div className="dock-result">
      <span className="r-line">
        {awards.length === 0 ? (
          'The hand is over.'
        ) : (
          awards.map((a) => (
            <span key={`${a.seat}-${a.amount}`}>
              <b>
                {a.seat === view.you ? 'You win' : `${name(a.seat)} wins`}{' '}
                <span className="num">{a.amount}</span>
              </b>
              {a.hand ? ` with ${a.hand.toLowerCase()}` : ''}
            </span>
          ))
        )}
      </span>
      <span className="badge num" role="timer">
        {last ? 'Result in' : 'Next hand in'} {left}
      </span>
    </div>
  );
}

/* The way out, for somebody with no seat. The same row in the watching state
   and at hand end, because a spectator's one control does not change. */
export function StopWatching() {
  return (
    <div className="dock-watch">
      <span className="w-note">Hole cards turn over at showdown</span>
      <Link className="btn btn-secondary btn-sm" to="/watch">
        Stop watching
      </Link>
    </div>
  );
}

function HandOver({ view }: { view: TableView }) {
  return (
    <>
      <HandResult view={view} />
      {/* The three choices stay in the box as inert ghosts: the dock's height
          is the same in every state, and the eye keeps its place. A spectator
          has no choices to hold open, so the same row carries the one thing
          that is theirs to press. */}
      {view.you == null ? (
        <StopWatching />
      ) : (
        <div className="dock-acts" aria-hidden="true">
          <span className="btn btn-tertiary ghost">Fold</span>
          <span className="btn btn-secondary ghost">Check</span>
          <span className="btn btn-primary ghost" data-primary>Raise</span>
        </div>
      )}
    </>
  );
}

/* The hold the server keeps a finished hand on screen for. Counted from the
   moment this hand's result arrived, so a reconnecting client is late rather
   than wrong. */
function useCountdown(key: string, ms: number): number {
  const [left, setLeft] = useState(() => Math.ceil(ms / 1000));
  useEffect(() => {
    const until = Date.now() + ms;
    setLeft(Math.ceil(ms / 1000));
    const id = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [key, ms]);
  return left;
}

/* ---------------------------------------------------------------- your turn */

/* The table's keys, in one place. `r` reaches for wherever the size is chosen
   (the dock's field, the band's sizer) and the number keys write a preset into
   it, so the two renderings differ only in what those two words mean.

   `r` works while typing, because it is how you get back to the field; every
   other shortcut is blocked by `isTextEntry`, so typing 137 into the field
   does not fold the hand. */
export function useTurnKeys({
  legal, presets, sending, onAct, onRaiseKey, onPresetKey,
}: {
  legal: LegalActions;
  presets: Preset[];
  sending: boolean;
  onAct: (a: ActionKind, v?: number) => void;
  onRaiseKey: () => void;
  onPresetKey: (value: number) => void;
}) {
  const { actions } = legal;
  const { canRaise, checkOrCall } = raiseShape(legal);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sending || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = isTextEntry(e.target);
      const k = e.key.toLowerCase();
      if (k === 'r' && canRaise && !typing) {
        e.preventDefault();
        onRaiseKey();
        return;
      }
      if (typing) return;
      if (k === 'f' && actions.includes('f')) { e.preventDefault(); onAct('f'); }
      else if (k === 'c' && checkOrCall) { e.preventDefault(); onAct(checkOrCall); }
      else if (k >= '1' && k <= '6') {
        const p = presets[Number(k) - 1];
        if (p) { e.preventDefault(); onPresetKey(p.value); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, canRaise, checkOrCall, onAct, presets, sending, onRaiseKey, onPresetKey]);
}


function TurnControls({
  view, legal, sending, onAct,
}: {
  view: TableView;
  legal: NonNullable<TableView['legal']>;
  sending: boolean;
  onAct: (a: ActionKind, v?: number) => void;
}) {
  const { actions, call, min, max } = legal;
  /* What raising means in this spot, read off `legal` in one place, because
     the phone's hero band draws the same decision (see `sizing.ts`). */
  const { canRaise, isBet, checkOrCall } = raiseShape(legal);
  const myBet = view.seats.find((s) => s.i === view.you)?.bet ?? 0;

  const presets = useMemo(
    () => (canRaise ? presetsFor(legal, view.pot, myBet, view.street) : []),
    [canRaise, legal, view.pot, myBet, view.street],
  );

  /* The typed amount is the source of truth. It is a string while it is being
     typed, so "1" on the way to "135" is not clamped up to the minimum under
     the cursor; the clamp lands on submit and blur, where it is visible. */
  const [raw, setRaw] = useState(() => String(min));
  const value = Number(raw);
  const fieldRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useGInit(wrapRef);

  /* A fresh decision resets the size to the minimum: carrying the last one
     into a new spot is how people put a stack in by accident. */
  useEffect(() => setRaw(String(min)), [min, max, view.h, view.n]);

  /* g owns the slider fill and its readout and syncs them on the input event.
     Replaying that event after a programmatic change keeps one owner. React
     bails on a set to the same value, so this cannot loop. */
  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    const v = String(clamp(Number.isFinite(value) ? value : min, min, max));
    if (el.value !== v) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, [value, min, max]);

  const submitRaise = useCallback(() => {
    if (sending || !canRaise) return;
    const typed = Number.isFinite(value) ? Math.round(value) : min;
    const fixed = clamp(typed, min, max);
    /* Clamping is shown, never silent: an out of range number lands in the
       field first and the next press sends it. */
    if (fixed !== typed) {
      setRaw(String(fixed));
      fieldRef.current?.select();
      return;
    }
    const { kind, value: amount } = raiseAction(legal, fixed);
    if (amount == null) onAct(kind);
    else onAct(kind, amount);
  }, [sending, canRaise, value, min, max, legal, onAct]);

  const focusField = useCallback(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);
  const writePreset = useCallback((v: number) => setRaw(String(v)), []);
  useTurnKeys({ legal, presets, sending, onAct, onRaiseKey: focusField, onPresetKey: writePreset });

  const raiseLabel = value >= max ? `All in ${max}` : isBet ? `Bet ${value || min}` : `Raise to ${value || min}`;

  return (
    <div className="dock-turn" ref={wrapRef}>
      <div className="dock-presets" role="group" aria-label="Bet sizes">
        {presets.map((p, i) => (
          <button
            key={p.key}
            type="button"
            className="btn btn-tertiary btn-sm preset"
            disabled={sending}
            aria-pressed={value === p.value}
            data-on={value === p.value ? '' : undefined}
            onClick={() => { playClick(); setRaw(String(p.value)); }}
            title={`${p.label}, key ${i + 1}`}
          >
            <span className="p-n">{p.label}</span>
            <span className="p-v num">{p.value}</span>
          </button>
        ))}
      </div>

      <div className="dock-size">
        <label className="dock-field">
          <span className="label">{isBet ? 'Bet' : 'Raise to'}</span>
          <input
            ref={fieldRef}
            className="input num"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={raw}
            disabled={sending || !canRaise}
            aria-label={isBet ? 'Bet amount' : 'Raise to amount'}
            onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setRaw(String(clamp(Number.isFinite(value) && raw !== '' ? Math.round(value) : min, min, max)))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitRaise(); } }}
          />
        </label>
        {/* Secondary, and desktop only: the field is how a size is chosen and
            the slider is for feeling out the range. No data-output, because
            the field beside it already prints the number. */}
        <span className="g-slider dock-slider">
          <input
            ref={rangeRef}
            type="range"
            min={min}
            max={max}
            step={1}
            defaultValue={min}
            disabled={sending || !canRaise}
            aria-label={isBet ? 'Bet size' : 'Raise to'}
            onChange={(e) => setRaw(e.target.value)}
          />
        </span>
      </div>

      <div className="dock-acts">
        {actions.includes('f') && (
          <button
            type="button"
            className="btn btn-tertiary"
            disabled={sending}
            onClick={() => { playClick(); onAct('f'); }}
          >
            Fold
          </button>
        )}
        {checkOrCall && (
          <button
            type="button"
            className={canRaise ? 'btn btn-secondary num' : 'btn btn-primary num'}
            data-primary={canRaise ? undefined : ''}
            disabled={sending}
            onClick={() => { playClick(); onAct(checkOrCall); }}
          >
            {checkOrCall === 'x' ? 'Check' : `Call ${call}`}
          </button>
        )}
        {canRaise && (
          <button
            type="button"
            className="btn btn-primary num"
            data-primary
            disabled={sending}
            onClick={() => { playClick(); submitRaise(); }}
          >
            {raiseLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/* One spaced line under the dock, desktop only, and the same line in every
   state: a legend that comes and goes is a legend that moves the felt. */
export function KeyLegend(
  { watching, className = 'dock-keys' }: { watching?: boolean; className?: string } = {},
) {
  /* A spectator has no keys to press, and a legend that offers three of them
     is a legend that lies. The row still renders, and holds its height, so the
     felt is the same size whether you are playing or watching. */
  if (watching) return <div className={className} aria-hidden="true" />;
  return (
    <div className={className} aria-hidden="true">
      <span><span className="kbd">F</span> fold</span>
      <span><span className="kbd">C</span> check or call</span>
      <span><span className="kbd">R</span> raise</span>
      <span><span className="kbd">1</span> to <span className="kbd">6</span> sizes</span>
      <span><span className="kbd">Enter</span> send</span>
    </div>
  );
}
