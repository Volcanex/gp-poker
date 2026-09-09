import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { ActionKind, Card, SeatView, TableView } from '@opentable/protocol';
import { Seat } from './seat.tsx';
import { PlayingCard } from './playing-card.tsx';
import { ChipStack } from './chip-stack.tsx';
import { Dock, KeyLegend, playerList } from './dock.tsx';
import { HeroBand } from './hero-band.tsx';
import { StakeBadge } from '../routes/feed.tsx';
import { MODE_NAME } from '../ui/mode-tabs.tsx';
import { blindsRow, cardsOf, faceUp, handText, streetText } from './labels.ts';
import { dealFrom, dealOrder, layoutMode, placeOf, seatOrder } from './layout.ts';
import { amountToCall } from './preactions.ts';
import { readShowdown } from './best-five.ts';
import { useTableSounds } from './sounds.ts';
import { useGInit, useMedia } from '../ui/bits.tsx';
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
  /* A practice table's hand-over state offers the next hand early; the band
     renders the button and this is what it calls. */
  onNext?: () => void;
  /* A sat-out seat's way back in. The band draws the prompt and the button;
     this is what they send. */
  onBack?: () => void;
}

const BOARD_SLOTS = 5;

/* Wide enough for the band to hold the hand, the controls and a practice
   table's readings side by side. Under it the readings keep their own row. */
const BAND_STATS = '(min-width: 1100px)';

/* The hand-end sequence, in the order the eye needs it: the cards turn over,
   then the five that count are outlined and the rest of the board goes quiet,
   then the chips move. Each number is the moment that step starts. */
const REVEAL_MS = 0;
const HIGHLIGHT_MS = 400;
const SETTLE_MS = 700;

const EASE_OUT = [0.2, 0, 0, 1] as const;

/* The award line is written in rather than faded in: a mask that opens from
   its leading edge, over in a fifth of a second. The shape lives in
   look-v2.css and only the fraction still covered is animated. */
const AWARD_MS = 220;
const AWARD_SHUT = { '--wipe': '100%' };
const AWARD_OPEN = { '--wipe': '0%' };

export function Table({ view, onAct, sending, bare, ended, chat, look = 'v1', onNext, onBack }: TableProps) {
  const reduced = useReducedMotion();
  const headRef = useRef<HTMLDivElement>(null);
  useGInit(headRef);
  useTableSounds(bare ? null : view);

  /* The bottom slot is yours when you are seated; watching, seat 0 takes it.
     Everyone else goes round the table from your left: up the left column,
     across the board and down the right one. */
  const order = seatOrder(view.seats, view.you);
  const mode = layoutMode(order.length);
  const button = view.seats.find((s) => s.button)?.i ?? 0;
  const deal = dealOrder(view.seats, button);
  const dealt = Math.max(1, deal.size);

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
     the key legend between them on a screen wide enough to hold one. */
  const band = look === 'v2' && !bare && !ended;

  /* **A practice table's readings are a section of the band, not a bar of
     their own**, on a screen wide enough to hold a third column. The owner's
     note was that the strip should not be its own bar, and it was the only
     thing on this screen that was a bar rather than a part of something; the
     felt takes its row back. Narrower than that it is still the strip, because
     a band split three ways leaves the sizes too narrow to read.

     One reading in one place: `LiveStats` drives the analysis worker and two
     of them would cancel each other's requests, so this picks the host rather
     than rendering it twice and hiding one. */
  const wideStats = useMedia(BAND_STATS);
  const inBand = band && strip && wideStats && hole != null;

  const result = view.street === 'done' ? view.result : null;
  const phase = useHandEnd(result ? `${view.m}:${view.h}` : null, reduced);

  /* An all-in run-out turns every live hand over before the board is
     finished, so the flip is keyed on a seat's cards being face up rather
     than on a result that has not arrived yet. Once it does arrive the same
     two cards are still there, so nothing flips a second time. */
  const runout = view.runout ?? null;
  const revealOf = (s: SeatView): Card[] | null =>
    cardsOf(result?.shown, s.i) ?? (runout && faceUp(s.cards) ? s.cards : null);

  const show = useShowdown(view, result, phase);

  /* The pot is paid at the last step of the sequence: its stack ticks to
     nothing and the winner's ticks up by the same chips. Until then every
     figure on the felt holds what it held before the result arrived, because
     the result message carries the paid stacks 700 ms before the chips move. */
  const settled = phase >= 2;
  const potShown = settled ? 0 : view.pot;

  /* Your own stack, held the same way and handed to the band, so there is one
     reading of when a hand is paid rather than two that drift. */
  const myAward = view.you == null ? 0 : show.awarded.get(view.you) ?? 0;
  const heroStack = mySeat == null || settled || myAward === 0
    ? mySeat?.stack ?? 0
    : mySeat.stack - myAward;

  const matchUrl = `${window.location.origin}/m/${view.m}`;

  return (
    <LookContext.Provider value={look}>
    {look === 'v2' && <DeckSprite />}
    <div
      className="match"
      data-look={look === 'v2' ? 'v2' : undefined}
      data-mode={mode}
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
        <span className="spacer" style={{ flex: 1 }} />
        {/* Only the actions live here; the hand, the street and the blinds are
            in the stats box under the board. Every control is always rendered:
            Verify used to appear when the seed was published, which moved the
            header at the end of every hand. */}
        <span className="head-acts">
          <button
            type="button"
            className="btn btn-tertiary btn-sm copy-btn"
            data-copy={matchUrl}
            aria-label="Copy a link to this match"
          >
            <span className="copy-label">Copy link</span>
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
            const place = placeOf(k, order.length);
            const award = show.awarded.get(s.i) ?? 0;
            const seat = settled || award === 0 ? s : { ...s, stack: s.stack - award };
            return (
              <div
                className="pos"
                key={s.i}
                data-seat={s.i}
                data-k={k}
                data-col={place?.col}
                style={{
                  '--r': place ? `s${place.row}` : 'hero',
                  '--c': place ? place.col[0] : 'l',
                } as CSSProperties}
              >
                <Seat
                  seat={seat}
                  you={s.i === view.you}
                  clock={view.clock}
                  format={view.format}
                  reveal={revealOf(s)}
                  handNo={view.h}
                  dealAt={deal.get(s.i) ?? 0}
                  seatCount={dealt}
                  origin={dealFrom(place)}
                  best={show.best}
                />
              </div>
            );
          })}

          {/* The board: five slots in one row across the top of the felt, above
              the seats and the pot. All five are always drawn, empty before
              the flop, so a street arriving moves nothing. It used to be split
              round the pot, which read as two boards rather than one hand. */}
          <div className="board">
            {board.map((c, i) => (
              <PlayingCard
                key={`${view.h}-b${i}`}
                card={c}
                index={0}
                best={c != null && show.best.size > 0 && show.best.has(c)}
                dim={c != null && show.best.size > 0 && !show.best.has(c)}
              />
            ))}
          </div>

          <div className="middle">
            {/* The pot sits between the wings, under the board: its chips with
                its figure under them. No label: a stack of chips in the middle
                of a table is the pot. */}
            <div className="pot">
              <span className="pot-chips">
                <ChipStack amount={potShown} />
              </span>
              {/* Keyed on the value: a figure that changes in place is a
                  text node the layout-shift observer sees move when its
                  box is centred, and a fresh node is new content. */}
              <span className="v num" key={potShown}>{potShown}</span>
              {view.pots.length > 1 && (
                <span className="pot-side num">{view.pots.map((p) => p.amount).join(' + ')}</span>
              )}
            </div>

            {/* The award line. The zone holds its height in every street so
                nothing on the felt moves when a hand is paid. */}
            {/* The award line, and between the streets of a run-out the count
                to the next card. One zone, one reserved height, one thing in
                it at a time: a run-out has nothing to award yet and a paid
                hand has nothing left to count to. */}
            <div className="award-zone">
              {runout && (
                /* Keyed on the value, so a new number is new content rather
                   than a text node moving inside a centred box. */
                <span className="badge num" role="timer" key={`${runout.next}-${runout.in}`}>
                  {streetText(runout.next)} in {runout.in}
                </span>
              )}
              <AnimatePresence>
                {settled && show.awards.map((a) => (
                  <motion.span
                    key={`${a.seat}-${a.amount}`}
                    className="badge num award-chip"
                    initial={reduced ? false : AWARD_SHUT}
                    animate={AWARD_OPEN}
                    exit={AWARD_SHUT}
                    transition={{ duration: AWARD_MS / 1000, ease: EASE_OUT }}
                  >
                    {a.amount} to {view.seats.find((s) => s.i === a.seat)?.name ?? `seat ${a.seat}`}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>

            <StatsBox view={view} />
          </div>
        </div>
      </div>

      {strip && !inBand && (
        <div className="practice-strip">
          {hole && <LiveStats hole={hole} board={view.board} opponents={opponents} />}
        </div>
      )}

      {chat && !bare && !ended && <ChatPanel chat={chat} />}

      {!bare && !ended && (
        <>
          {band ? (
            <HeroBand
              view={view}
              onAct={onAct}
              sending={sending}
              best={show.best}
              stack={heroStack}
              onNext={onNext}
              onBack={onBack}
              stats={inBand && hole
                ? <LiveStats hole={hole} board={view.board} opponents={opponents} />
                : null}
            />
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

/* The facts about the hand, in one box under the board where the eye already
   is: labels left, values right, one type size, every value in a reserved
   width. A format without levels has no next level to count to, and whether
   it has one is settled before the first card, so the row count is fixed for
   the length of the match. */
function StatsBox({ view }: { view: TableView }) {
  const blinds = blindsRow(view.format, view.blinds, view.h);
  const rows: [string, string, string?][] = [
    ['Hand', handText(view.h, view.format.hands).replace(/^Hand /, '')],
    ['Street', streetText(view.street)],
    ['Blinds', blinds.blinds],
  ];
  if (blinds.next != null) rows.push(['Next level', blinds.next, 'stats-next']);
  rows.push(['To call', String(amountToCall(view))]);
  return (
    <dl className="stats" aria-label="Hand">
      {rows.map(([k, v, cls]) => (
        /* The value is keyed on itself, so a change is a new node rather than
           a text node moving inside its right-aligned box, which the
           layout-shift observer counts. */
        <Fragment key={k}>
          <dt className={cls}>{k}</dt>
          <dd className={cls ? `num ${cls}` : 'num'} key={v}>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/* Your own two cards, or nothing. A seat with no cards is out of the hand and
   a seat showing '?' is somebody else's, so neither has a holding to analyse. */
function holeOf(seat: SeatView | null): [Card, Card] | null {
  const cards = seat?.cards;
  if (!faceUp(cards)) return null;
  return [cards![0], cards![1]];
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
