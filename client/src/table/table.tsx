import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import { useGamePanelOpen, useMedia, useRootAttr, useTableInfo, useGInit } from '../ui/bits.tsx';
import { updatePrefs } from '../ui/prefs.ts';
import { LiveStats } from '../analysis/live-stats.tsx';
import { ChatFab, ChatPanel, ChatToggle } from '../chat/chat.tsx';
import { LeaveControl } from './leave-control.tsx';
import type { ChatController } from '../chat/use-chat.ts';
import { LookContext, type Look } from './look.ts';
import { DeckSprite } from './deck-sprite.tsx';
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown';
import { DotsThreeCircle } from '@phosphor-icons/react/dist/icons/DotsThreeCircle';
import { useTopActsSlot, useTopGameSlot } from '../ui/shell.tsx';
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
  /* Leaving the game. Given only by a page that has a match to leave, so the
     replay and any other embedder of the felt get no control at all. What
     pressing it means, and whether it asks first, is `leave-control.tsx`. */
  onLeave?: () => void;
}

const BOARD_SLOTS = 5;

/* Wide enough for the band to hold the hand, the controls and a practice
   table's readings side by side. Under it the readings keep their own row. */
const BAND_STATS = '(min-width: 1100px)';

/* Wide enough for the site's own top bar to hold the match's actions beside
   the account and settings menus it already carries on this route at every
   width. The account button carries whatever the signed-in name measures,
   which is not capped the way a seat's is, so this keeps real margin above
   the width four controls plus a short name needs rather than the width a
   long one costs; below it the actions keep the felt's own header row
   instead, the way they always have. */
const TOP_BAR_ACTS = '(min-width: 900px)';

/* A phone. The game panel is a 340 px card, which on a 390 px screen is a
   row nearly as tall as the felt it sits over; below this the hand's
   readings stand in the felt and the actions in `.hand-head`, whatever the
   setting says, since the setting is about where a panel goes on a screen
   that has room for one. The number is the felt's own narrow container
   query in `../app.css`. */
const PHONE = '(max-width: 560px)';

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

export function Table({ view, onAct, sending, bare, ended, chat, look = 'v1', onNext, onBack, onLeave }: TableProps) {
  const reduced = useReducedMotion();
  const headRef = useRef<HTMLSpanElement>(null);
  useTableSounds(bare ? null : view);
  /* The site's own top bar, portalled the actions into its middle: null until
     it has mounted, which is the one render this waits out. `useGInit` fires
     once on this component's own mount, before the slot exists, so `head-acts`
     is not there yet for it to find; this waits for the slot instead and
     wires the portalled span the moment it actually has one. */
  const topActs = useTopActsSlot();
  /* And on a phone, the bar's end slot, where the settings button stands on
     every other screen: the actions go into a "Game" menu there, the felt
     gets the header row back, and the chat toggle becomes a button on the
     felt itself. Null above 560 (`../ui/shell.tsx` renders the slot only for
     a phone table), so nothing is portalled where the slot is not. */
  const topGame = useTopGameSlot();
  /* Below 900 the top bar has no room left for them (see `TOP_BAR_ACTS`), so
     the actions stand in the felt's own header row instead, exactly as they
     did before this had a middle to go to. Only read in `seat` mode: the
     game panel is `panelMode`'s own home for them and never asks the top
     bar for anything. */
  const wideHead = useMedia(TOP_BAR_ACTS);
  /* Where the hand's own facts and the match's actions are read from: a
     setting (`ui/prefs.ts`), read live because which placement is on
     decides this component's own DOM shape. */
  const info = useTableInfo();
  const phone = useMedia(PHONE);
  const panelMode = info === 'panel' && !bare && !phone;
  const gameMenu = phone && !bare && topGame != null;
  /* The phone felt as rows (`data-rows` on `.felt`, the geometry in
     `../app.css`): a seated player's two seat table always, and a bigger
     table when the Other seats setting says detailed. A spectator keeps the
     column geometry, because the bottom seat is a player's and still has to
     be placed; a bare replay keeps it because it is a document. */
  const detailed = useRootAttr('data-seat-detail') === 'detailed';

  /* A live table on a phone locks the page: `data-table` on the root turns
     the document's own scrolling off (`../app.css`), because a page exactly
     one screen tall still rubber-bands and drags the browser's toolbar away
     to show bare ground under the band. The felt scrolls its own overflow
     as it always has. A finished match is a document again. */
  useEffect(() => {
    if (bare || ended) return undefined;
    document.documentElement.setAttribute('data-table', '');
    return () => document.documentElement.removeAttribute('data-table');
  }, [bare, ended]);
  /* Wired on whichever render actually mounts the span, wherever it is: the
     portal's own node arrives a render after `topActs` does, crossing 900
     swaps one span for the other, and switching the setting swaps the top
     bar or `.hand-head` for the game panel, so `headRef` points at a fresh,
     unwired node more than once in this component's life. `useGInit`'s
     once-on-mount guard cannot see any of that. */
  useEffect(() => {
    const el = headRef.current;
    if (!el || el.dataset.gDone === '1') return;
    el.dataset.gDone = '1';
    window.g?.init(el);
  }, [topActs, wideHead, panelMode, gameMenu]);

  /* The bottom slot is yours when you are seated; watching, seat 0 takes it.
     Everyone else goes round the table from your left: up the left column,
     across the board and down the right one. */
  const order = seatOrder(view.seats, view.you);
  const mode = layoutMode(order.length);
  const rows = phone && !bare && view.you != null && (mode === 'stack' || detailed);
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

  const headEl = (
    <span className="head-acts" ref={headRef}>
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
      {/* Only somebody with a seat has a game to leave, and whether they have
          one cannot change mid-match, which is what makes this safe to leave
          out of a spectator's header rather than disable. */}
      {onLeave && view.you != null && (
        <LeaveControl format={view.format} ended={Boolean(ended)} out={mySeat?.out ?? false} onLeave={onLeave} />
      )}
      {chat && !gameMenu && <ChatToggle chat={chat} />}
    </span>
  );

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

      {/* The match's own actions, wherever the `tableInfo` setting sends
          them. `panelMode`: the game panel, top right, holds both this and
          the stats box, and neither the top bar nor `.hand-head` sees them.
          Otherwise: the site's top bar above 900 (`TOP_BAR_ACTS`), portalled
          into the slot `SiteShell` renders in `header.top`, or the felt's
          own header row below it, where the top bar has no room left for
          them beside the account and settings menus it already carries on
          this route. One element either way, declared once so its homes
          cannot drift into two different sets of controls. Every control is
          always rendered: Verify used to appear only once the seed was
          published, which moved whichever header held it at the end of
          every hand. */}
      {gameMenu && createPortal(<GameMenu>{headEl}</GameMenu>, topGame)}
      {!bare && !panelMode && !gameMenu && wideHead && topActs && createPortal(headEl, topActs)}
      {!bare && !panelMode && !gameMenu && !wideHead && (
        <div className="hand-head">
          <div className="bar-in">{headEl}</div>
        </div>
      )}
      {panelMode && <GamePanel stats={<StatsBox view={view} />} actions={headEl} />}

      <div className="felt" data-mode={mode} data-seats={order.length} data-rows={rows ? '' : undefined}>
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
                  won={award > 0}
                  blind={view.blinds.sb}
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
                <ChipStack amount={potShown} centred level={view.blinds.sb} />
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
          </div>

          {/* `seat` mode only: `panelMode` is already false for a bare
              replay, which has no game panel to draw and always reads the
              felt itself here instead. Six-max leaves the right wing's
              bottom seat empty (the hero sits in the band, not here), and
              heads-up leaves the whole column spare: a direct child of the
              felt's own grid rather than the middle column's, so it can
              stand in that corner above 1060 and fall back to the middle
              strip, under the pot, below it. */}
          {!panelMode && <StatsBox view={view} />}
        </div>
      </div>

      {strip && !inBand && (
        <div className="practice-strip">
          {hole && <LiveStats hole={hole} board={view.board} opponents={opponents} />}
        </div>
      )}

      {chat && !bare && !ended && <ChatPanel chat={chat} />}
      {chat && gameMenu && !ended && <ChatFab chat={chat} />}

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

/* The phone's home for the match's own actions: g's menu on the Popover API
   at the end of the site's top bar, in the slot the settings button gives up
   there (settings goes into the sheet). The same `head-acts` span as every
   other home, laid out as a column by `../app.css`, so the controls cannot
   drift into a different set; the leave control's dialog opens from inside
   the popover into the top layer above it. `useGInit` on the wrapper is what
   places the menu under its trigger. */
function GameMenu({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useGInit(wrapRef);
  return (
    <div className="game" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-tertiary btn-sm"
        popoverTarget="game-menu"
        aria-haspopup="menu"
      >
        <DotsThreeCircle size={20} aria-hidden="true" />
        Game
      </button>
      <div className="menu game-menu" popover="auto" id="game-menu" aria-label="Game">
        {children}
      </div>
    </div>
  );
}

/* `panelMode`'s home for the hand's own facts and the match's own actions:
   one card, top right of the match screen, under the profile chip in the
   site's own top bar directly above it. Both were their own thing once (the
   stats box in a seat, the actions in a header row); one card reads as one
   panel of information about the match you are in, which is what the two
   were anyway.

   It floats over the felt rather than taking a row of the table's grid; the
   rules for where and why are in `../app.css` under "game panel".

   **The chevron shuts it.** The two halves of this card are read at
   completely different rates: the hand, the street and the blinds are read
   every hand, and Copy link, Verify, Leave game and Chat are pressed once a
   match if at all. Shut, the facts stay and the controls fold away, so the
   card over the felt is one line instead of four. It is a setting rather
   than this component's own state (`gamePanel` in `../ui/prefs.ts`), because
   a player who shuts it wants it shut next hand and next match, not until
   the next re-render.

   Its own box does not resize as Verify or Leave game enable and disable,
   the same rule `.head-acts` has always kept: `stats` is a fixed five rows
   (`StatsBox` always renders `To call`, whether or not it is your turn to
   answer it) and `actions` is the same `head-acts` span `seat` mode portals
   elsewhere, Leave game always rendered for a seated player. */
function GamePanel({ stats, actions }: { stats: ReactNode; actions: ReactNode }) {
  const open = useGamePanelOpen();
  return (
    <div className="game-panel" data-open={open ? '' : undefined}>
      <div className="gp-head">
        {stats}
        <button
          type="button"
          className="gp-toggle"
          aria-expanded={open}
          aria-controls="game-panel-acts"
          title={open ? 'Hide the match controls' : 'Show the match controls'}
          aria-label={open ? 'Hide the match controls' : 'Show the match controls'}
          onClick={() => updatePrefs({ gamePanel: open ? 'shut' : 'open' })}
        >
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
      {/* `hidden` rather than unmounted: the dialog `LeaveControl` owns is
          wired by an effect in this file that walks `head-acts` for it (see
          `./CLAUDE.md`), and a group that leaves the DOM every time the card
          is shut is a group that comes back unwired. */}
      <div className="gp-acts" id="game-panel-acts" hidden={!open}>
        <div className="gp-div" aria-hidden="true" />
        {actions}
      </div>
    </div>
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
