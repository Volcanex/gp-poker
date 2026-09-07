import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { Link } from 'react-router-dom';
import type { ActionKind, TableView } from '@opentable/protocol';
import { Seat } from './seat.tsx';
import { PlayingCard } from './playing-card.tsx';
import { ActionBar } from './action-bar.tsx';
import { cardsOf, shortHash, streetText } from './labels.ts';
import { useGInit } from '../ui/bits.tsx';

export interface TableProps {
  view: TableView;
  onAct: (a: ActionKind, v?: number) => void;
  sending: boolean;
}

interface Flight { id: number; seat: number; amount: number }

const BOARD_SLOTS = 5;

export function Table({ view, onAct, sending }: TableProps) {
  const reduced = useReducedMotion();
  const headRef = useRef<HTMLDivElement>(null);
  useGInit(headRef);

  const you = view.you == null ? null : view.seats.find((s) => s.i === view.you) ?? null;
  const others = view.seats.filter((s) => s.i !== view.you);

  /* Chips fly to the pot when the street's bets are collected: the seat's chip
     unmounts and one with the same layoutId mounts over the pot, so the move is
     a single continuous element rather than two fades. */
  const [flights, setFlights] = useState<Flight[]>([]);
  const prev = useRef<TableView | null>(null);
  const flightId = useRef(0);

  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || reduced) return;
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
    const timer = setTimeout(() => setFlights((f) => f.filter((x) => !ids.has(x.id))), 480);
    return () => clearTimeout(timer);
  }, [view, reduced]);

  const board = Array.from({ length: BOARD_SLOTS }, (_, i) => view.board[i] ?? null);
  const result = view.street === 'done' ? view.result : null;
  const canAct = view.legal != null && you != null;

  return (
    <div className="match">
      <div className="hand-head" ref={headRef}>
       <div className="bar-in">
        <span className="n">Hand {view.h} of {view.format.hands}</span>
        <span className="dot">·</span>
        <span>{streetText(view.street)}</span>
        <span className="dot">·</span>
        <span className="num">Blinds {view.format.sb}/{view.format.bb}</span>
        <span className="spacer" style={{ flex: 1 }} />
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
          {view.seed && (
            <Link className="btn btn-tertiary btn-sm" to={`/m/${view.m}/h/${view.h}`}>
              Verify
            </Link>
          )}
        </span>
       </div>
      </div>

      <div className="felt">
        <div className="side">
          {others.map((s) => (
            <div key={s.i}>
              <Seat
                seat={s}
                you={false}
                clock={view.clock}
                format={view.format}
                reveal={cardsOf(result?.shown, s.i)}
                n={view.n}
                handNo={view.h}
              />
              <div className="seat-bet">
                {s.bet > 0 && (
                  <motion.span layoutId={`bet-${s.i}`} className="badge num">{s.bet}</motion.span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="middle">
          <div className="pot">
            <span className="k">Pot</span>
            <span className="v">
              <NumberFlow value={view.pot} respectMotionPreference />
            </span>
            {view.pots.length > 1 && (
              <span className="side">{view.pots.map((p) => p.amount).join(' + ')}</span>
            )}
            <span className="flights" aria-hidden="true">
              <AnimatePresence>
                {flights.map((f) => (
                  <motion.span
                    key={f.id}
                    layoutId={`bet-${f.seat}`}
                    className="badge num"
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                  >
                    {f.amount}
                  </motion.span>
                ))}
              </AnimatePresence>
            </span>
          </div>

          <div className="board">
            {board.map((c, i) => (
              <PlayingCard key={`${view.h}-b${i}`} card={c} index={Math.max(0, i - 2)} />
            ))}
          </div>

          {result && (
            <div className="showdown">
              {result.awards.map((a) => {
                const seat = view.seats.find((s) => s.i === a.seat);
                return (
                  <span className="w" key={`${a.seat}-${a.amount}`}>
                    {seat?.name ?? `Seat ${a.seat}`} wins <span className="num">{a.amount}</span>
                    {a.hand ? ` with ${a.hand}` : ''}
                  </span>
                );
              })}
              <span className="d">Next hand shortly</span>
            </div>
          )}
        </div>

        <div className="side you">
          {you && (
            <>
              <div className="seat-bet">
                {you.bet > 0 && (
                  <motion.span layoutId={`bet-${you.i}`} className="badge num">{you.bet}</motion.span>
                )}
              </div>
              <Seat
                seat={you}
                you
                clock={view.clock}
                format={view.format}
                reveal={cardsOf(result?.shown, you.i)}
                n={view.n}
                handNo={view.h}
              />
            </>
          )}
        </div>
      </div>

      {canAct && view.legal ? (
        <ActionBar
          legal={view.legal}
          pot={view.pot}
          myBet={you?.bet ?? 0}
          disabled={sending}
          onAct={onAct}
        />
      ) : (
        <div className="waiting-bar">{waitingText(view)}</div>
      )}
    </div>
  );
}

function waitingText(view: TableView): string {
  if (view.you == null) return 'Spectating. Actions are hidden for watchers.';
  if (view.street === 'done') return 'Hand over. The next one deals in a moment.';
  const acting = view.seats.find((s) => s.acting);
  if (acting && acting.i !== view.you) return `Waiting for ${acting.name}`;
  return 'Waiting for the next card';
}
