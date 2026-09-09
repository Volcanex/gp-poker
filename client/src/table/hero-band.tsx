import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ActionKind, Card, LegalActions, TableView } from '@opentable/protocol';
import { holdFor } from '@opentable/protocol';
import { PlayingCard } from './playing-card.tsx';
import { ChipStack } from './chip-stack.tsx';
import { TurnBar, TurnSeconds } from './turn-clock.tsx';
import {
  CUSTOM_KEY, KeyLegend, PRESET_KEYS, PreActionPills, StopWatching, useCountdown, useDockLogic,
  useTurnKeys, waitingText,
} from './dock.tsx';
import type { DockState } from './dock.tsx';
import { isLastHand } from './preactions.ts';
import { SITTING_OUT_TEXT, sittingOutNow } from './sitout.ts';
import type { PreAction } from './preactions.ts';
import {
  clamp, dupKeys, openAt, presetsStack, raiseAction, raiseLabel, raiseShape,
} from './sizing.ts';
import type { Preset } from './sizing.ts';
import { playClick } from './sounds.ts';
import { actionText, shortName } from './labels.ts';
import { isTextEntry, useFading, useMedia } from '../ui/bits.tsx';
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
  /* A practice table holds a finished hand until this viewer deals on: when
     `view.hold` is `'you'` the decision line's end is a button rather than a
     countdown, and this is what it calls. */
  onNext?: () => void;
  /* Your seat is sitting out and this is the way back in. The band draws the
     prompt and the button; the page sends the message. */
  onBack?: () => void;
  /* A practice table's readings, as a section on the right of the band rather
     than a bar of their own above it. `table.tsx` decides whether this band or
     the strip hosts them, because the reading behind them runs a worker and
     two of it would cancel each other's requests. Null on every other table
     and on a screen too narrow to hold a third column. */
  stats?: ReactNode;
}

/* The hold is the server's to declare; the field lands with the protocol
   change and is read here through a local widening until then. */
type HeldView = TableView & { hold?: 'you' };

/* The action band, in place of the dock, at every width. A decision line
   along the top edge, and under it two columns: your own two cards drawn at
   the size you would hold them, with your name, your stack and your chips
   under them, and a column of controls beside them. Which side each takes is
   a setting, because a phone is held in one hand and the thumb only reaches
   one edge.

   The dock's rule holds here and is the reason nothing in this file measures
   itself: one box, one height, four states rendered into it. Every control is
   rendered in every state it belongs to and disabled rather than dropped, and
   every string that changes sits in a slot with a size of its own. */

/* Above this the raise control is a grid of sizes under a mouse; below it, a
   sweep under a thumb. The same number the stylesheet's phone block uses. */
const WIDE = '(min-width: 561px)';

export function HeroBand({
  view, onAct, sending, best, stack, onNext, onBack, stats,
}: HeroBandProps) {
  const { state, pre, setPre, canPre } = useDockLogic(view, onAct, sending);
  const mine = view.you == null ? null : view.seats.find((s) => s.i === view.you) ?? null;
  const legal = view.legal;
  const wide = useMedia(WIDE);
  const sittingOut = sittingOutNow(view, state === 'over');

  return (
    <div
      className="hero-band"
      data-state={state}
      data-seated={mine ? '' : undefined}
      data-sitout={sittingOut ? '' : undefined}
      data-stats={stats ? '' : undefined}
    >
      <DecisionLine view={view} state={state} onNext={onNext} sittingOut={sittingOut} />

      {/* The band's ground runs the width of the page and its content sits on
          the felt's column, so the cards start on the felt's left edge and the
          controls end on its right one. */}
      <div className="hb-in">
        {mine && <HeroCards view={view} best={best} stack={stack} />}

        {/* One quiet line under the controls, gone on a phone where there is
            no keyboard to legend. It says the same thing in every state, so it
            is rendered outside the column that changes. */}
        <KeyLegend className="hb-keys" watching={view.you == null} sizes={6} custom />

        {/* The readings stand in a column of their own on the far side of the
            controls, whole for the life of the table: they are the same three
            in every state of the band, so they are placed here rather than in
            the column that swaps. */}
        {stats && <div className="hb-stats">{stats}</div>}

        <div className="hb-col">
          {sittingOut ? (
            <SitOutColumn onBack={onBack} />
          ) : state === 'turn' && legal ? (
            <TurnColumn view={view} legal={legal} sending={sending} onAct={onAct} wide={wide} />
          ) : state === 'over' ? (
            <OverColumn view={view} />
          ) : state === 'watch' ? (
            <WatchColumn />
          ) : (
            <WaitColumn pre={pre} onPre={setPre} canPre={canPre} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- decision line */

/* The one line of words on the band, and the only status the band has: what
   you have to decide, or who is being waited for, or who won, with the clock
   or the countdown at its right end and the clock's bar as its floor. It is
   the band's top edge because that is where the eye lands coming down off
   the felt, and it is one line because the band used to say the same thing
   in three places (a pot note, a status line, a result with a badge) and a
   player looking for the decision had to read all of them to find it.

   Every state prints into the same two slots: the words snap, the row is one
   height, and the bar under it is drawn empty when nobody's clock is running
   so the floor is there in every state. */
function DecisionLine({
  view, state, onNext, sittingOut,
}: {
  view: TableView;
  state: DockState;
  onNext?: () => void;
  sittingOut?: boolean;
}) {
  const clock = view.clock;
  const yours = clock != null && clock.seat === view.you;
  const mine = view.you == null ? null : view.seats.find((s) => s.i === view.you) ?? null;
  /* A practice table holds the hand for you: the end slot is the way on
     rather than a countdown. */
  const held = state === 'over' && (view as HeldView).hold === 'you' && onNext != null;

  let text: string;
  let end: ReactNode = null;
  if (held) {
    text = resultText(view);
    end = <DealNext onNext={onNext} />;
  } else if (state === 'over') {
    text = resultText(view);
    end = <HandCountdown view={view} />;
  } else {
    text = sittingOut
      ? SITTING_OUT_TEXT
      : state === 'turn' && view.legal
      ? decisionText(view.legal, mine?.stack ?? 0)
      : state === 'watch'
        ? `Watching, ${actingText(view)}`
        : mine?.out ? waitingText(view) : actingText(view, true);
    if (clock) {
      end = <TurnSeconds deadline={clock.deadline} totalMs={view.format.clockMs} paused={clock.paused} />;
    }
  }

  return (
    <div
      className="hb-line"
      data-whose={clock ? (yours ? 'you' : 'them') : undefined}
      data-held={held ? '' : undefined}
    >
      <span className="hb-line-text">{text}</span>
      <span className="hb-line-end num">{end}</span>
      {clock ? (
        <TurnBar deadline={clock.deadline} totalMs={view.format.clockMs} paused={clock.paused} />
      ) : (
        <span className="turn-bar" aria-hidden="true" />
      )}
    </div>
  );
}

/* What the words say on your turn: the price, or that there is none. An all
   in to call is named, because the number alone does not say it is your whole
   stack. */
export function decisionText(legal: LegalActions, stack: number): string {
  const { canRaise, isBet, checkOrCall } = raiseShape(legal);
  if (legal.call > 0) return legal.call >= stack ? 'All in to call' : `${legal.call} to call`;
  if (checkOrCall === 'x') return canRaise ? (isBet ? 'Check or bet' : 'Check or raise') : 'Check';
  return canRaise ? (isBet ? 'Bet' : 'Raise') : 'Your turn';
}

/* Who is being waited for, by name, the way a dealer says it. Capitalised at
   the start of the line and not after "Watching," where it continues one. */
function actingText(view: TableView, lead = false): string {
  const acting = view.seats.find((s) => s.acting);
  if (acting && acting.i !== view.you) return `${acting.name} to act`;
  return lead ? 'Waiting for the next card' : 'waiting for the next card';
}

/* Who won what, as one sentence. Split pots join with "and". */
export function resultText(view: TableView): string {
  const awards = view.result?.awards ?? [];
  if (awards.length === 0) return 'The hand is over';
  const name = (seat: number) => view.seats.find((s) => s.i === seat)?.name ?? `Seat ${seat}`;
  return awards
    .map((a) => `${a.seat === view.you ? 'You win' : `${name(a.seat)} wins`} ${a.amount}`
      + (a.hand ? ` with ${a.hand.toLowerCase()}` : ''))
    .join(' and ');
}

/* The hold counted down at the end of the line. Its own component so the
   interval only runs while a hand is over. */
function HandCountdown({ view }: { view: TableView }) {
  const left = useCountdown(`${view.m}:${view.h}`, holdFor(view.format));
  return (
    <span role="timer">{isLastHand(view) ? 'Result in' : 'Next hand in'} {left}</span>
  );
}

/* The way on from a held hand. It stands in the countdown's reserved slot,
   out of the flow and anchored to its right end, because "Deal the next hand"
   is wider than the slot and a slot that grew would move the line's words.
   Enter and N press it, the way Enter sends a size, and neither fires while
   somebody is typing in the chat. */
function DealNext({ onNext }: { onNext: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) return;
      const k = e.key.toLowerCase();
      if (k !== 'enter' && k !== 'n') return;
      e.preventDefault();
      onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext]);
  return (
    <button
      type="button"
      className="btn btn-primary hb-line-next"
      title="Enter or N"
      onClick={() => { playClick(); onNext(); }}
    >
      Deal the next hand
    </button>
  );
}

/* ------------------------------------------------------------------ cards */

/* Your hand, at the size the sketch asked for: two cards overlapped and fanned
   in the corner, big enough to read without looking for them, with your name,
   your stack, your chips and your last action on one edge under them. The
   felt does not draw your seat on v2 at any width (see hero-band.css) because
   this is that seat, drawn once and drawn large.

   The deal runs on the first render of a hand and not again: `still` is a
   state rather than a ref, so the flag flips after the deal has already been
   handed to motion, and the cards are keyed on the hand so a new one deals. */
function HeroCards({
  view, best, stack,
}: {
  view: TableView;
  best?: ReadonlySet<Card>;
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
          {/* The big three denominations beside the figure, the way the felt's
              seats carry them: they say deep or short at a glance, and they
              tick when the figure changes, which is what says a bet has left
              or a pot has landed. Every column keeps its slot, so the label
              after them does not move. */}
          <span className="hb-chips"><ChipStack amount={stack} columns={3} /></span>
          {/* A reserved slot: the label is empty most of the hand and a box
              that sizes to it would move the stack every time it filled. */}
          <span className="hb-last">{label}</span>
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
  const { canRaise, isBet, checkOrCall } = raiseShape(legal);
  const { call, min, max } = legal;
  /* One set of six at both widths, off the stack rather than off the pot. The
     phone confirms a size on the sweep, because a thumb lands anywhere and a
     box is small; a mouse presses the box and then the button that says what
     it will send. */
  const [sizing, setSizing] = useState(false);
  const [custom, setCustom] = useState(false);
  /* The typed size, while it is being typed: a string, so "1" on the way to
     "135" is not clamped up to the minimum under the cursor. The clamp lands
     on send, into the field, exactly as the dock's does. */
  const [raw, setRaw] = useState('');
  const presets = useMemo(() => (canRaise ? presetsStack(legal) : []), [canRaise, legal]);
  const dups = useMemo(() => dupKeys(presets), [presets]);
  /* A decision opens on Min: the loaded size is what the button and Enter
     send, and a band that came up holding a quarter of a stack is a stack lost
     to a keypress nobody meant. A size of your own starts from the quarter
     instead, which is what `sizerAt` is. */
  const [sel, setSel] = useState(0);
  const [value, setValue] = useState(min);
  const sizerAt = presets[openAt(presets, dups)]?.value ?? min;

  /* A fresh decision goes back to the box every decision opens on and closes
     whichever way in was open: carrying the last size into a new spot is how
     people put a stack in by accident, and a sizer left open over a hand you
     have not looked at is the same mistake with a slider on it. */
  useEffect(() => {
    setSel(0);
    setValue(min);
    setRaw(String(min));
    setSizing(false);
    setCustom(false);
  }, [min, max, view.h, view.n]);

  const send = useCallback((v: number) => {
    if (sending || !canRaise) return;
    const { kind, value: amount } = raiseAction(legal, v);
    if (amount == null) onAct(kind);
    else onAct(kind, amount);
  }, [sending, canRaise, legal, onAct]);

  /* The typed size is the source of truth while the field is open, and a
     number outside the legal range is clamped **into the field** rather than
     sent: the next press sends the clamped number, so a size nobody chose
     never reaches the server. */
  const typed = Number(raw);
  const typedValue = Number.isFinite(typed) && raw !== '' ? Math.round(typed) : min;
  const shown = custom ? typedValue : value;
  const confirm = useCallback(() => {
    if (sending || !canRaise) return;
    if (!custom) { playClick(); send(value); return; }
    const fixed = clamp(typedValue, min, max);
    if (fixed !== typedValue) { setRaw(String(fixed)); return; }
    playClick();
    send(fixed);
  }, [sending, canRaise, custom, send, value, typedValue, min, max]);

  /* The same keys the dock answers to. `r` reaches for a size of your own,
     which is the sweep under a thumb and the typed field under a mouse, and it
     is what the Bet button does on a phone. A number key addresses the box it
     is written in: on a wide band it loads that size into the button, and on a
     phone it opens the sweep on it. A blank box is a size another box already
     offers, and its key does nothing, the way the box does nothing. */
  const openSizer = useCallback(() => {
    setValue(sizerAt);
    setRaw(String(sizerAt));
    setSel(-1);
    if (wide) setCustom(true);
    else setSizing(true);
  }, [wide, sizerAt]);
  const takePreset = useCallback((p: Preset) => {
    if (dups.has(p.key)) return;
    setSel(presets.indexOf(p));
    setValue(p.value);
    setCustom(false);
    if (!wide) setSizing(true);
  }, [wide, dups, presets]);
  useTurnKeys({ legal, presets, sending, onAct, onRaiseKey: openSizer, onPresetKey: takePreset });

  /* Enter sends what the button says, on a band that has a keyboard. It is
     here rather than in the shared key hook because it only means anything
     while a size is loaded, and the field's own Enter is the same call. */
  useEffect(() => {
    if (!wide || !canRaise) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || sending || e.metaKey || e.ctrlKey || e.altKey) return;
      /* The field owns its own Enter, and it is the same call: without this
         the key runs the send twice on one press, once on the way out of the
         field and once here. */
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      confirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wide, canRaise, sending, confirm]);

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
    <div className="hb-turn">
      {wide && custom && canRaise ? (
        <CustomSize
          raw={raw}
          onRaw={setRaw}
          sending={sending}
          onSend={confirm}
          onClose={() => setCustom(false)}
        />
      ) : (
        <SizeGrid
          presets={presets}
          dups={dups}
          selected={presets[sel]?.key}
          sending={sending || !canRaise}
          onTake={(p) => { playClick(); takePreset(p); }}
          onCustom={wide ? () => { playClick(); openSizer(); } : undefined}
        />
      )}

      {/* Two groups under a mouse: fold and call on the left, the sizes and the
          button that sends one on the right. Three colours, and each button is
          here in every spot and disabled where it is not legal, so the row
          never changes shape. Under a thumb the same three stack up the
          column, the bet at the top and fold on the bottom edge. */}
      <div className="hb-acts">
        <button
          type="button"
          className="btn hb-act hb-act-fold"
          disabled={sending || !legal.actions.includes('f')}
          onClick={() => { playClick(); onAct('f'); }}
        >
          Fold
        </button>
        <button
          type="button"
          className="btn hb-act hb-act-call num"
          disabled={sending || checkOrCall == null}
          onClick={() => { if (checkOrCall) { playClick(); onAct(checkOrCall); } }}
        >
          {checkOrCall === 'c' ? `Call ${call}` : 'Check'}
        </button>
      </div>

      {/* The button carries the size that is loaded and sends it. On a phone it
          opens the sweep instead, because a size chosen with a thumb is worth
          confirming. The words are keyed on themselves: a centred string that
          changes in place is a text node the layout-shift observer sees move,
          and a fresh node is content arriving. */}
      <button
        type="button"
        className="btn hb-act hb-act-bet hb-bet num"
        disabled={sending || !canRaise}
        title={wide ? 'Enter sends, R for a size of your own' : undefined}
        onClick={() => { if (wide) confirm(); else { playClick(); openSizer(); } }}
      >
        <span key={wide && canRaise ? raiseLabel(legal, shown) : ''}>
          {wide && canRaise ? raiseLabel(legal, shown) : isBet ? 'Bet' : 'Raise'}
        </span>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- size grid */

/* The band's raise control at both widths: the six `presetsStack` gives, in
   the order the number keys address them. **A box says its amount and nothing
   else**, with its key drawn faintly in the corner: the old ten said "125%"
   over a number in a box the size of a stamp, and the owner read the whole
   grid as noise. What a size is called is in its title, where a name belongs
   once the number is the thing you press.

   Pressing one loads it into the button under them; on a phone it opens the
   sweep on it. A box whose amount another box already offers is drawn blank
   and disabled rather than dropped, so the keys stay where they are. When
   raising is not on the table the grid is empty and keeps its box. */
function SizeGrid({
  presets, dups, selected, sending, onTake, onCustom,
}: {
  presets: Preset[];
  dups: ReadonlySet<string>;
  selected?: string;
  sending: boolean;
  onTake: (p: Preset) => void;
  /* The seventh square, and only under a mouse: it is a way to a keyboard and
     a typed number, and a phone has neither. There the sweep is that way and
     the Bet button is how you reach it. */
  onCustom?: () => void;
}) {
  return (
    <div
      className="hb-sizes"
      data-custom={onCustom ? '' : undefined}
      role="group"
      aria-label="Bet sizes"
    >
      {presets.map((p, i) => {
        const blank = dups.has(p.key);
        return (
          <button
            key={p.key}
            type="button"
            className="hb-size"
            data-blank={blank ? '' : undefined}
            /* A blank box says nothing and cannot be pressed, so it is out of
               the accessibility tree rather than in it as a button with no
               name. Disabled, it is not focusable either. */
            aria-hidden={blank ? true : undefined}
            disabled={sending || blank}
            aria-pressed={p.key === selected}
            data-on={p.key === selected ? '' : undefined}
            title={blank ? undefined : `${p.label} of your stack, key ${PRESET_KEYS[i]}`}
            onClick={() => onTake(p)}
          >
            {!blank && (
              <>
                <span className="s-k" aria-hidden="true">{PRESET_KEYS[i]}</span>
                <span className="s-v num">{p.value}</span>
              </>
            )}
          </button>
        );
      })}
      {/* A size of your own, at the end of the row where its key is at the end
          of the row of keys. **It is not a preset**: it holds no number, and
          the key goes through the same door `r` does, so the sizer opens,
          focuses and clamps identically however it was asked for. */}
      {onCustom && (
        <button
          type="button"
          className="hb-size hb-size-custom"
          disabled={sending}
          aria-label="A size of your own"
          title={`A size of your own, key ${CUSTOM_KEY} or R`}
          onClick={onCustom}
        >
          <span className="s-k" aria-hidden="true">{CUSTOM_KEY}</span>
          {/* The word is decoration: the button says what it is through its
              label, so a band too narrow for seven words can draw the ellipsis
              in its place without the square going quiet to a screen reader. */}
          <span className="s-v" aria-hidden="true">Custom</span>
        </button>
      )}
    </div>
  );
}

/* A size of your own, in the grid's own box: the field, and the way back to
   the six. The button under it is the one that sends, so there is one confirm
   on the band rather than two. Enter sends from the field, Escape closes. */
function CustomSize({
  raw, onRaw, sending, onSend, onClose,
}: {
  raw: string;
  onRaw: (v: string) => void;
  sending: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="hb-custom">
      <label className="hb-custom-field">
        <span className="label">Your own size</span>
        <input
          ref={ref}
          className="input num"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={raw}
          disabled={sending}
          aria-label="Raise to amount"
          onChange={(e) => onRaw(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSend(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
      </label>
      <button type="button" className="btn btn-tertiary hb-custom-back" onClick={onClose}>
        Back
      </button>
    </div>
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

  /* Three marks, and only three: the ends of the range and the half. A short
     stack puts half of it within a few pixels of all in, and two labels three
     pixels apart say less than one, so a mark that lands on one already placed
     is dropped and the ends win. */
  const ticks = useMemo(() => {
    const half = clamp(presets.find((p) => p.key === 's50')?.value ?? max, min, max);
    const at = (v: number) => (max === min ? 0 : (v - min) / (max - min));
    const out = [
      { key: 'allin', label: 'All in', value: max },
      { key: 'min', label: 'Min', value: min },
      { key: 's50', label: '50%', value: half },
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
        className="btn hb-act-bet num hb-confirm"
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

/* The turn column's shape with the pre-action pills where the actions were,
   so the column reads the same while you wait as it does when it is on you.
   Who is being waited for is on the decision line. */
function WaitColumn({
  pre, onPre, canPre,
}: {
  pre: PreAction | null;
  onPre: (p: PreAction | null) => void;
  canPre: boolean;
}) {
  return (
    <div className="hb-turn">
      <div className="hb-sizes" aria-hidden="true" />
      <PreActionPills pre={pre} onPre={onPre} canPre={canPre} className="hb-pre" size="" />
    </div>
  );
}

/* ------------------------------------------------------------------- over */

/* The result is on the decision line. The three actions are held open as
   outlines in the boxes they were just in, group for group, so the control a
   hand is resting on when the hand ends is still where it was when the next
   one deals. On the match's last hand there is no next one to rest a control
   for, so the boxes hold their footprint empty rather than offering a fold,
   a check and a raise that will never be legal again. */
function OverColumn({ view }: { view: TableView }) {
  if (view.you == null) return <WatchColumn />;
  const last = isLastHand(view);
  return (
    <div className="hb-turn hb-ghosts" aria-hidden="true">
      <div className="hb-sizes" />
      <div className="hb-acts">
        {!last && (
          <>
            <span className="btn hb-act hb-act-fold ghost">Fold</span>
            <span className="btn hb-act hb-act-call ghost">Check</span>
          </>
        )}
      </div>
      {!last && <span className="btn hb-act hb-act-bet hb-bet ghost">Raise</span>}
    </div>
  );
}

/* ----------------------------------------------------------------- sit out */

/* Sitting out: the controls' own three rows, with one press where the three
   actions were. The sizes keep their box the way they do in every other
   state, so coming back does not move the band a pixel.

   One button and not three disabled ones, because fold, check and raise are
   not what is on offer here: the only decision a sat-out player has is
   whether to be at the table at all, and three greyed controls beside a line
   asking them to come back would read as the table refusing them. */
function SitOutColumn({ onBack }: { onBack?: () => void }) {
  return (
    <div className="hb-turn">
      <div className="hb-sizes" aria-hidden="true" />
      <div className="hb-acts hb-back">
        <button
          type="button"
          className="btn btn-primary hb-back-btn"
          onClick={() => { playClick(); onBack?.(); }}
        >
          Come back
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ watch */

function WatchColumn() {
  return (
    <div className="hb-watch">
      <StopWatching />
    </div>
  );
}
