import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { Link } from 'react-router-dom';
import type { ActionKind, Card, SeatView, TableView } from '@opentable/protocol';
import { Seat } from './seat.tsx';
import { PlayingCard } from './playing-card.tsx';
import { ChipStack } from './chip-stack.tsx';
import { Dock, KeyLegend, playerList } from './dock.tsx';
import { HeroBand } from './hero-band.tsx';
import { StakeBadge } from '../routes/feed.tsx';
import { MODE_NAME } from '../ui/mode-tabs.tsx';
import {
  blindText, blindTextShort, cardsOf, handText, handTextShort, shortHash, streetText,
} from './labels.ts';
import { dealOrder, layoutMode, portraitSlot, seatOrder, slotAt } from './layout.ts';
import { readShowdown } from './best-five.ts';
import { useTableSounds } from './sounds.ts';
import { useGInit } from '../ui/bits.tsx';
import { LiveStats } from '../analysis/live-stats.tsx';
import { ChatPanel, ChatToggle } from '../chat/chat.tsx';
import type { ChatController } from '../chat/use-chat.ts';
import { LookContext, type Look } from './look.ts';
import { DeckSprite } from './deck-sprite.tsx';
import './look-v2.css';

export interface TableProps {
  view: TableView;
  onAct: (a: ActionKind, v?: number) => void;
  sending: boolean;
  /* The replay supplies its own hand header and its own controls, so it asks
     for the felt on its own. */
  bare?: boolean;
  /* The match is over: the felt stays on screen behind the result panel. */
  ended?: boolean;
  /* Table chat, when this table has one. The toggle goes in the header and the
     panel beside or over the felt, never in a row of its own: see chat.css. */
  chat?: ChatController;
  /* The felt rework, on the mock only until it is the felt: see look.ts. */
  look?: Look;
}

interface Flight { id: number; seat: number; amount: number }

/* Where a stack of chips stands, in the felt's own coordinates: the middle of
   its bottom edge, plus the chip size in force there. A ring bet draws 14px
   chips and the middle draws 24px, so a flight scales as it travels and lands
   the size of the stack it is joining. */
interface Anchor { x: number; y: number; chip: number }

/* One stack in the air. v2 moves chips instead of dissolving them: an opaque
   element in a layer over the felt, from the measured place it left to the
   measured place it is going, moved on a transform. No opacity is touched at
   any point, and the two stacks are never on screen pretending to be one. */
interface Move {
  id: number;
  amount: number;
  from: Anchor;
  to: Anchor;
  delay: number; // seconds
  seat: number | null; // the seat an award is paid to, null on the way in
}

const BOARD_SLOTS = 5;

/* The hand-end sequence, in the order the eye needs it: the cards turn over,
   then the five that count are outlined and the rest of the board goes quiet,
   then the chips move. Each number is the moment that step starts. */
const REVEAL_MS = 0;
const HIGHLIGHT_MS = 400;
const SETTLE_MS = 700;

/* How a chip travels on v2. One stack a seat, in the order a dealer collects
   them, on the house ease-out. Long enough to follow across the felt and short
   enough that the next street is not waiting on it. */
const FLIGHT_MS = 380;
const STAGGER_MS = 40;
const EASE_OUT = [0.2, 0, 0, 1] as const;

/* The award line is written in rather than faded in: a mask that opens from
   its leading edge, over in a fifth of a second so it does not compete with
   the chips travelling beside it. The shape lives in look-v2.css and only the
   fraction still covered is animated. */
const AWARD_MS = 220;
const AWARD_SHUT = { '--wipe': '100%' };
const AWARD_OPEN = { '--wipe': '0%' };

const NOBODY: ReadonlySet<number> = new Set();

export function Table({ view, onAct, sending, bare, ended, chat, look = 'v1' }: TableProps) {
  const reduced = useReducedMotion();
  const headRef = useRef<HTMLDivElement>(null);
  useGInit(headRef);
  useTableSounds(bare ? null : view);

  /* The bottom slot is yours when you are seated; watching, seat 0 takes it.
     Two seats stack into the felt they have always had, three or more sit on
     an ellipse, and both come out of the same markup. */
  const order = seatOrder(view.seats, view.you);
  const mode = layoutMode(order.length);
  const button = view.seats.find((s) => s.button)?.i ?? 0;
  const deal = dealOrder(view.seats, button);
  const dealt = Math.max(1, deal.size);

  /* Chips fly to the pot when the street's bets are collected: the seat's chip
     unmounts and one with the same layoutId mounts over the pot, so the move is
     a single continuous element rather than two fades.

     **A flight's removal must outlive the view that started it.** The timer
     used to be returned from this effect, so the next state to arrive cancelled
     it; if that state moved no chips the effect returned early and never armed
     another, and the flight stayed on the table for good. Stepping a replay
     backwards did it every time, two chips a scrub, until a hundred of them
     were piled up sharing a handful of layout ids and motion was flinging them
     below the felt. The timers live in a ref now and are cleared on unmount and
     nowhere else. */
  const [flights, setFlights] = useState<Flight[]>([]);
  const prev = useRef<TableView | null>(null);
  const flightId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  /* v2's flights, and the two things that wait for one to land: the middle's
     stack, held at what it held before the bets were collected, and the seats
     whose winnings have arrived. Positions are read off the DOM because the
     felt has three geometries (the heads-up stack, the ring, the phone's
     portrait grid) and only the browser knows which is in force. */
  const [moves, setMoves] = useState<Move[]>([]);
  const [potHeld, setPotHeld] = useState<number | null>(null);
  const [paid, setPaid] = useState<ReadonlySet<number>>(NOBODY);
  const feltRef = useRef<HTMLDivElement>(null);
  const chipAt = useRef(new Map<number, Anchor>());
  const prevV2 = useRef<TableView | null>(null);
  const awardDone = useRef<string | null>(null);
  const flying = look === 'v2' && !bare && !reduced;

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    /* A replay steps in both directions. Chips that fly to the pot when you
       step forward would have to fly back out of it when you step back, and a
       recorded hand is read, not watched: it has no flights at all. */
    if (!before || reduced || bare || look === 'v2') return;
    if (before.h !== view.h) {
      setFlights([]);
      return;
    }
    const moved = before.seats.filter(
      (s) => s.bet > 0 && (view.seats.find((t) => t.i === s.i)?.bet ?? 0) === 0,
    );
    if (moved.length === 0) return;
    const batch = moved.map((s) => ({ id: (flightId.current += 1), seat: s.i, amount: s.bet }));
    const ids = new Set(batch.map((b) => b.id));
    setFlights((f) => [...f, ...batch]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFlights((f) => f.filter((x) => !ids.has(x.id)));
    }, 480);
    timers.current.add(timer);
  }, [view, reduced, bare, look]);

  /* v2: the bets travel to the middle. Measured before the recorder below
     refreshes, so `chipAt` still holds the felt as it was drawn a moment ago,
     which is the only place the chips that have just been collected exist. */
  useLayoutEffect(() => {
    const before = prevV2.current;
    prevV2.current = view;
    const root = feltRef.current;
    if (!flying || !root || !before) return;
    if (before.h !== view.h) {
      setMoves([]);
      setPotHeld(null);
      setPaid(NOBODY);
      return;
    }
    const moved = before.seats.filter(
      (s) => s.bet > 0 && (view.seats.find((t) => t.i === s.i)?.bet ?? 0) === 0,
    );
    if (moved.length === 0) return;
    const slot = root.querySelector('.pot-chips');
    if (!slot) return;
    const base = root.getBoundingClientRect();
    const to = anchorOf(slot, base);
    /* In the order a dealer collects: from the seat left of the button round
       to it, one stack every 40ms, so four bets read as four stacks. */
    const n = Math.max(1, before.seats.length);
    const round = (i: number) => (i - button - 1 + n * 2) % n;
    const batch = [...moved]
      .sort((a, b) => round(a.i) - round(b.i))
      .map((s) => ({ amount: s.bet, from: chipAt.current.get(s.i) }))
      .filter((m): m is { amount: number; from: Anchor } => m.from != null)
      .map((m, k): Move => ({
        id: (flightId.current += 1),
        amount: m.amount,
        from: m.from,
        to,
        delay: (k * STAGGER_MS) / 1000,
        seat: null,
      }));
    if (batch.length === 0) return;
    setMoves((m) => [...m, ...batch]);
    setPotHeld(collectedOf(before));
    batch.forEach((f, k) => {
      const last = k === batch.length - 1;
      const t = setTimeout(() => {
        timers.current.delete(t);
        /* The flight is taken off the felt in the same tick the middle's stack
           grows by what it carried, at the same place: a swap, not a fade. */
        setMoves((m) => m.filter((x) => x.id !== f.id));
        setPotHeld((held) => (last || held == null ? null : held + f.amount));
      }, f.delay * 1000 + FLIGHT_MS);
      timers.current.add(t);
    });
  }, [view, flying, button]);

  const board = Array.from({ length: BOARD_SLOTS }, (_, i) => view.board[i] ?? null);
  /* Practice tables carry the analysis strip. It is a row of the same grid as
     the header, the felt and the dock, with a height of its own, so the felt
     divides once and stays divided: a strip that appeared when the flop came
     would move the whole table under it. Rendered for the length of the match,
     not only while you hold cards, for the same reason. */
  const mySeat = view.you == null ? null : view.seats.find((s) => s.i === view.you) ?? null;
  const strip = view.format.practice === true && !bare && !ended;
  /* Nobody's seat is yours, so you are watching. A replay has no seat either
     and is drawn bare, without any of this. */
  const watching = view.you == null && !bare && !ended;
  const hole = holeOf(mySeat);
  const opponents = view.seats.filter(
    (s) => s.i !== view.you && !s.folded && !s.out && s.cards != null,
  ).length;

  /* v2 swaps the dock for the hero band at every width: your own cards drawn
     large in one corner and the controls under the thumb in the other, with
     the key legend between them on a screen wide enough to hold one. The
     phone layout is the base and the desktop one is it scaled up, which is
     why this is one component rather than two. */
  const band = look === 'v2' && !bare && !ended;

  const result = view.street === 'done' ? view.result : null;
  const phase = useHandEnd(result ? `${view.m}:${view.h}` : null, reduced);

  const show = useShowdown(view, result, phase);

  const potShown = phase >= 2 ? 0 : view.pot;
  const settled = phase >= 2;
  /* The figure is the protocol's pot, the total including the bets still in
     front of players. v2 draws those bets as chips at their seats, so the
     middle's stack is the total less what is still on the line, and a bet's
     stack landing is what makes it grow. Held at its old value while the
     chips are in the air. */
  const potChips = look === 'v2' ? (phase >= 2 ? 0 : potHeld ?? collectedOf(view)) : potShown;

  /* v2: the middle leaves for the winner, one opaque stack a seat, and the
     chips stay in front of them until the next hand deals. A split pot flies
     to every winner in turn; the award line under the board names them all.

     The key is the hand rather than the awards, because the view arrives with
     a fresh board array on every message and the showdown memo behind it
     rebuilds; without the guard the same pot would fly on every tick. */
  const awardAt = flying && settled && show.awards.length > 0 ? `${view.m}:${view.h}` : null;
  useLayoutEffect(() => {
    const root = feltRef.current;
    if (awardAt == null || !root || awardDone.current === awardAt) return;
    const slot = root.querySelector('.pot-chips');
    if (!slot) return;
    awardDone.current = awardAt;
    const base = root.getBoundingClientRect();
    const from = anchorOf(slot, base);
    const batch: Move[] = [];
    const straight: number[] = [];
    show.awards.forEach((a, k) => {
      const to = chipAt.current.get(a.seat);
      /* A seat that has never had a chip drawn in front of it has nowhere to
         fly to. It is paid where it stands instead. */
      if (!to) {
        straight.push(a.seat);
        return;
      }
      batch.push({
        id: (flightId.current += 1),
        amount: a.amount,
        from,
        to,
        delay: (k * STAGGER_MS) / 1000,
        seat: a.seat,
      });
    });
    if (straight.length > 0) setPaid((p) => new Set([...p, ...straight]));
    if (batch.length === 0) return;
    setMoves((m) => [...m, ...batch]);
    for (const f of batch) {
      const t = setTimeout(() => {
        timers.current.delete(t);
        setPaid((p) => new Set([...p, f.seat as number]));
      }, f.delay * 1000 + FLIGHT_MS);
      timers.current.add(t);
    }
  }, [awardAt, show.awards]);

  /* Where every seat's chips are standing, refreshed on each commit and kept
     when they leave, so a flight starts from the last place they stood. It is
     declared after both flights above on purpose: those read the felt as it
     was drawn before this update, which is where the chips that have just
     moved still are. */
  useLayoutEffect(() => {
    const root = feltRef.current;
    if (!flying || !root) return;
    const base = root.getBoundingClientRect();
    for (const pos of root.querySelectorAll('.pos')) {
      const chips = pos.querySelector('.bet-chip .chips');
      const i = Number(pos.getAttribute('data-seat'));
      if (chips && Number.isFinite(i)) chipAt.current.set(i, anchorOf(chips, base));
    }
  });

  /* The winner's number waits for the chips: it ticks up when the stack lands.
     Without flights (v1, a replay, reduced motion) settling is the moment. */
  const landed = (i: number) => (flying ? paid.has(i) : settled);

  /* v1 keeps the award line it has, dropping in from the pot as it fades. v2
     has no fade anywhere on the felt, so the line is masked in instead. */
  const v2Award = look === 'v2';

  return (
    <LookContext.Provider value={look}>
    {look === 'v2' && <DeckSprite />}
    <div
      className="match"
      data-look={look === 'v2' ? 'v2' : undefined}
      /* The felt stops drawing your own seat only when the band is actually
         on screen and it is actually yours: a spectator's bottom seat belongs
         to a player, and hiding it would leave nothing in its place. */
      data-band={band && view.you != null ? '' : undefined}
      data-bare={bare ? '' : undefined}
      data-ended={ended ? '' : undefined}
      data-practice={strip ? '' : undefined}
    >
      {watching && <WatchBar view={view} />}

      {!bare && (
      <div className="hand-head" ref={headRef}>
       <div className="bar-in">
        <span className="n wide">{handText(view.h, view.format.hands)}</span>
        <span className="n narrow">{handTextShort(view.h, view.format.hands)}</span>
        <span className="dot">·</span>
        <span className="street">{streetText(view.street)}</span>
        <span className="dot">·</span>
        <span className="num wide">{blindText(view.format, view.blinds, view.h)}</span>
        <span className="num narrow">{blindTextShort(view.blinds)}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {/* Both controls are always here. Verify used to appear beside Copy the
            moment the seed was published, which moved the header at the end of
            every hand. */}
        <span className="seed">
          <code title={view.seedHash}>{shortHash(view.seedHash)}</code>
          <button
            type="button"
            className="btn btn-tertiary btn-sm copy-btn"
            data-copy={view.seedHash}
            aria-label="Copy the seed hash"
          >
            <span className="copy-label">Copy</span>
          </button>
          {view.seed ? (
            <Link className="btn btn-tertiary btn-sm" to={`/m/${view.m}/h/${view.h}`}>
              Verify
            </Link>
          ) : (
            <span className="btn btn-tertiary btn-sm" aria-disabled="true" title="Published when the hand completes">
              Verify
            </span>
          )}
        </span>
        {chat && <ChatToggle chat={chat} />}
       </div>
      </div>
      )}

      <div className="felt" data-mode={mode} data-seats={order.length}>
        <div className="felt-in" ref={feltRef}>
          {order.map((s, k) => {
            const slot = slotAt(k, order.length);
            /* Two geometries, one set of elements: the ellipse reads --x and
               --y, the phone's portrait grid reads --gr, --gc and --gs, and
               which one applies is a container query. */
            const cell = portraitSlot(k, order.length);
            const award = show.awarded.get(s.i) ?? 0;
            const seat = landed(s.i) || award === 0 ? s : { ...s, stack: s.stack - award };
            return (
              <div
                className="pos"
                key={s.i}
                data-seat={s.i}
                data-half={slot.half}
                data-side={slot.side}
                data-k={k}
                style={{
                  '--x': `${slot.x}%`,
                  '--y': `${slot.y}%`,
                  '--yt': `${slot.yTight}%`,
                  '--gr': cell.row,
                  '--gc': cell.col,
                  '--gs': cell.span,
                } as CSSProperties}
              >
                <div className="seat-bet">
                  {s.bet > 0 && (
                    <motion.span
                      layoutId={look === 'v2' ? undefined : `bet-${s.i}`}
                      className="bet-chip num"
                    >
                      <ChipStack amount={s.bet} />
                      <span className="bet-figure">{s.bet}</span>
                    </motion.span>
                  )}
                </div>
                <Seat
                  seat={seat}
                  you={s.i === view.you}
                  clock={view.clock}
                  format={view.format}
                  reveal={cardsOf(result?.shown, s.i)}
                  n={view.n}
                  handNo={view.h}
                  dealAt={deal.get(s.i) ?? 0}
                  seatCount={dealt}
                  origin={mode === 'ring' ? { x: slot.ox, y: slot.oy } : undefined}
                  best={show.best}
                  handLabel={show.names.get(s.i) ?? null}
                  /* The one stack that animates is the winner's, counting up
                     as the pot lands. Everywhere else the number snaps: a
                     stack that rolls every time a blind is posted spends the
                     deal painting two values at once, which is what a live
                     table was caught doing two and a half seconds in. */
                  snap={!(landed(s.i) && award > 0)}
                />
              </div>
            );
          })}

          <div className="middle">
            <div className="pot">
              <span className="k">Pot</span>
              {look === 'v2' ? (
                <span className="pot-chips">
                  {potChips > 0 && <ChipStack amount={potChips} />}
                </span>
              ) : (
                <ChipStack amount={potShown} />
              )}
              <span className="v">
                <NumberFlow value={potShown} respectMotionPreference />
              </span>
              {view.pots.length > 1 && (
                <span className="pot-side">{view.pots.map((p) => p.amount).join(' + ')}</span>
              )}
              {look !== 'v2' && (
              <span className="flights" aria-hidden="true">
                <AnimatePresence>
                  {flights.map((f) => (
                    <motion.span
                      key={f.id}
                      layoutId={`bet-${f.seat}`}
                      className="bet-chip num"
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                    >
                      <ChipStack amount={f.amount} />
                      <span className="bet-figure">{f.amount}</span>
                    </motion.span>
                  ))}
                </AnimatePresence>
              </span>
              )}
            </div>

            <div className="board">
              {board.map((c, i) => (
                <PlayingCard
                  key={`${view.h}-b${i}`}
                  card={c}
                  index={Math.max(0, i - 2)}
                  best={c != null && show.best.size > 0 && show.best.has(c)}
                  dim={c != null && show.best.size > 0 && !show.best.has(c)}
                />
              ))}
            </div>

            {/* The pot's chips land here, below the figure and clear of the
                label they used to cover. The zone holds its height in every
                street so nothing on the felt moves when a hand is awarded. */}
            <div className="award-zone">
              <AnimatePresence>
                {settled && show.awards.map((a) => (
                  <motion.span
                    key={`${a.seat}-${a.amount}`}
                    className="badge num award-chip"
                    initial={reduced ? false : v2Award ? AWARD_SHUT : { y: -54, opacity: 0, scale: 0.9 }}
                    animate={v2Award ? AWARD_OPEN : { y: 0, opacity: 1, scale: 1 }}
                    exit={v2Award ? AWARD_SHUT : { opacity: 0 }}
                    transition={{ duration: v2Award ? AWARD_MS / 1000 : 0.34, ease: EASE_OUT }}
                  >
                    {a.amount} to {view.seats.find((s) => s.i === a.seat)?.name ?? `seat ${a.seat}`}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* The chips in the air. Absolutely positioned over the felt and out
              of the flow, so nothing on it can be moved by a flight. */}
          {look === 'v2' && (
            <div className="chip-flights" aria-hidden="true">
              {moves.map((f) => (
                <motion.span
                  key={f.id}
                  className="chip-flight"
                  style={{ left: f.from.x, top: f.from.y, '--chip': `${f.from.chip}px` } as CSSProperties}
                  initial={{ x: 0, y: 0, scale: 1 }}
                  animate={{
                    x: f.to.x - f.from.x,
                    y: f.to.y - f.from.y,
                    scale: f.to.chip / f.from.chip,
                  }}
                  transition={{ duration: FLIGHT_MS / 1000, ease: EASE_OUT, delay: f.delay }}
                >
                  <ChipStack amount={f.amount} />
                </motion.span>
              ))}
            </div>
          )}
        </div>
      </div>

      {strip && (
        <div className="practice-strip">
          {hole && <LiveStats hole={hole} board={view.board} opponents={opponents} />}
        </div>
      )}

      {chat && !bare && !ended && <ChatPanel chat={chat} />}

      {!bare && !ended && (
        <>
          {band ? (
            <HeroBand view={view} onAct={onAct} sending={sending} best={show.best} />
          ) : (
            <>
              <Dock view={view} onAct={onAct} sending={sending} />
              {/* The band carries its own legend, in its middle column, so on
                  v2 the table has one row fewer. v1 keeps the row it has. */}
              <KeyLegend watching={view.you == null} />
            </>
          )}
        </>
      )}
    </div>
    </LookContext.Provider>
  );
}

/* The middle of a stack's bottom edge, in the felt's own coordinates, with the
   chip size in force where it stands. Both ends of a flight are measured this
   way, so a stack leaves and lands standing on the same line the stacks it
   came from and joined stand on. */
function anchorOf(el: Element, base: DOMRect): Anchor {
  const r = el.getBoundingClientRect();
  const chip = Number.parseFloat(getComputedStyle(el).getPropertyValue('--chip'));
  return {
    x: r.left + r.width / 2 - base.left,
    y: r.bottom - base.top,
    chip: Number.isFinite(chip) && chip > 0 ? chip : 24,
  };
}

/* What is actually in the middle. The protocol's pot is the total including
   the bets still in front of players; v2 draws those at their seats, so the
   middle's own stack is the total less what is still on the line. */
function collectedOf(view: TableView): number {
  return Math.max(0, view.pot - view.seats.reduce((a, s) => a + s.bet, 0));
}

/* Your own two cards, or nothing. A seat with no cards is out of the hand and
   a seat showing '?' is somebody else's, so neither has a holding to analyse. */
function holeOf(seat: SeatView | null): [Card, Card] | null {
  const cards = seat?.cards;
  if (!cards || cards.length !== 2 || cards.some((c) => c === '?')) return null;
  return [cards[0], cards[1]];
}

/* Which step of the hand-end sequence we are on: 0 reveal, 1 highlight,
   2 settle. Reduced motion lands on the last step immediately, which is the
   same information with none of the staging. */
function useHandEnd(key: string | null, reduced: boolean | null): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (key == null) {
      setPhase(0);
      return;
    }
    if (reduced) {
      setPhase(2);
      return;
    }
    setPhase(0);
    const timers = [
      setTimeout(() => setPhase(1), HIGHLIGHT_MS - REVEAL_MS),
      setTimeout(() => setPhase(2), SETTLE_MS - REVEAL_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [key, reduced]);
  return phase;
}

interface Awarded {
  best: ReadonlySet<Card>;
  names: Map<number, string>;
  awarded: Map<number, number>; // what each seat was just paid
  awards: { seat: number; amount: number }[];
}

const NOTHING: Awarded = { best: new Set(), names: new Map(), awarded: new Map(), awards: [] };

/* The highlight waits for the reveal: nothing is outlined until the cards have
   turned over, which is why the phase is an input here. */
function useShowdown(view: TableView, result: TableView['result'], phase: number): Awarded {
  return useMemo(() => {
    if (!result) return NOTHING;
    const awarded = new Map<number, number>();
    for (const a of result.awards) awarded.set(a.seat, (awarded.get(a.seat) ?? 0) + a.amount);
    const awards = result.awards.map((a) => ({ seat: a.seat, amount: a.amount }));
    if (phase < 1) return { best: new Set(), names: new Map(), awarded, awards };
    const board = view.board.filter((c): c is Card => typeof c === 'string');
    const { best, names } = readShowdown(result, board);
    return { best, names, awarded, awards };
  }, [result, phase, view.board]);
}

/* Who is at the table, for somebody who is not. The first row of the grid, so
   it takes its height from the table rather than from the page above it. */
function WatchBar({ view }: { view: TableView }) {
  return (
    <div className="watch-bar">
      <div className="bar-in">
        <span className="tagset">
          <span className="badge badge-plain">{MODE_NAME[view.format.mode]}</span>
          <StakeBadge
            rated={view.format.rated}
            practice={view.format.practice === true}
            homeGame={view.format.homeGame === true}
            arena={view.format.arena ?? null}
          />
        </span>
        <span className="w-who">
          Watching <b>{playerList(view)}</b>
        </span>
      </div>
    </div>
  );
}
