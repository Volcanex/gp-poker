import { useEffect, useMemo, useRef, useState } from 'react';
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

const BOARD_SLOTS = 5;

/* The hand-end sequence, in the order the eye needs it: the cards turn over,
   then the five that count are outlined and the rest of the board goes quiet,
   then the chips move. Each number is the moment that step starts. */
const REVEAL_MS = 0;
const HIGHLIGHT_MS = 400;
const SETTLE_MS = 700;

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
    if (!before || reduced || bare) return;
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
  }, [view, reduced, bare]);

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

  return (
    <LookContext.Provider value={look}>
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
        <div className="felt-in">
          {order.map((s, k) => {
            const slot = slotAt(k, order.length);
            /* Two geometries, one set of elements: the ellipse reads --x and
               --y, the phone's portrait grid reads --gr, --gc and --gs, and
               which one applies is a container query. */
            const cell = portraitSlot(k, order.length);
            const award = show.awarded.get(s.i) ?? 0;
            const seat = settled || award === 0 ? s : { ...s, stack: s.stack - award };
            return (
              <div
                className="pos"
                key={s.i}
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
                    <motion.span layoutId={`bet-${s.i}`} className="bet-chip num">
                      <ChipStack amount={s.bet} />
                      {s.bet}
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
                  snap={!(settled && award > 0)}
                />
              </div>
            );
          })}

          <div className="middle">
            <div className="pot">
              <span className="k">Pot</span>
              <ChipStack amount={potShown} />
              <span className="v">
                <NumberFlow value={potShown} respectMotionPreference />
              </span>
              {view.pots.length > 1 && (
                <span className="pot-side">{view.pots.map((p) => p.amount).join(' + ')}</span>
              )}
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
                      {f.amount}
                    </motion.span>
                  ))}
                </AnimatePresence>
              </span>
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
                    initial={reduced ? false : { y: -54, opacity: 0, scale: 0.9 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.34, ease: [0.2, 0, 0, 1] }}
                  >
                    {a.amount} to {view.seats.find((s) => s.i === a.seat)?.name ?? `seat ${a.seat}`}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>
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
