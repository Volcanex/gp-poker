import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { Card } from '@opentable/protocol';
import { DeckSprite } from '../table/deck-sprite.tsx';
import { PlayingCard } from '../table/playing-card.tsx';
import { LookContext } from '../table/look.ts';
import { elapsed, useNow } from '../ui/bits.tsx';
import { useTitle } from '../ui/title.ts';
import { sound } from '../sound/index.ts';
import type { SoundEvent } from '../sound/index.ts';
import {
  canComplete, canMove, cardsAt, findSource, isWon, newGame, play, restoreGame, RANKS, SUITS,
} from './klondike.ts';
import type { Action, Board, Destination, Game, Source, TableauCard } from './klondike.ts';
import { cascade } from './cascade.ts';
import type { Launch } from './cascade.ts';
import { GLIDE_MS, TURN_MS, glide, measure, overlap, reducedMotion, shake, springBack, stopAll, turn } from './motion.ts';
import './solitaire.css';

const STORAGE_KEY = 'ot.solitaire.v1';
const HINT = 'Build the four foundations from ace to king.';
const SUIT_NAMES = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const RANK_NAMES: Record<string, string> = { A: 'Ace', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King' };
const cardName = (card: Card) => `${RANK_NAMES[card[0]] ?? card[0]} of ${SUIT_NAMES[SUITS.indexOf(card[1] as typeof SUITS[number])].toLowerCase()}`;
const stackOffset = (pile: TableauCard[], index: number) => {
  const below = pile.slice(0, index);
  const hidden = below.filter((c) => !c.faceUp).length;
  return `calc(${hidden} * var(--sol-hidden-step) + ${below.length - hidden} * var(--sol-step))`;
};
const DESTINATIONS: Destination[] = [
  ...SUITS.map((_, pile): Destination => ({ kind: 'foundation', pile })),
  ...Array.from({ length: 7 }, (_, pile): Destination => ({ kind: 'tableau', pile })),
];
const dropId = (to: Destination) => `${to.kind[0]}${to.pile}`;
const hiddenCount = (board: Board) => board.tableau.reduce((n, pile) => n + pile.filter((c) => !c.faceUp).length, 0);
const foundationCount = (board: Board) => board.foundations.reduce((n, pile) => n + pile.length, 0);
/* A little pitch wander, so twenty cards landing do not sound like one card
   landing twenty times. */
const jitter = () => 0.96 + Math.random() * 0.08;

function loadGame(): { game: Game; fresh: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = restoreGame(raw);
      if (saved) return { game: saved, fresh: false };
    }
  } catch { /* Storage may be unavailable in a private browser. */ }
  return { game: newGame(), fresh: true };
}

/* Which side of each card is showing. */
function faces(board: Board): Map<Card, boolean> {
  const up = new Map<Card, boolean>();
  board.stock.forEach((c) => up.set(c, false));
  board.waste.forEach((c) => up.set(c, true));
  board.foundations.flat().forEach((c) => up.set(c, true));
  board.tableau.flat().forEach((c) => up.set(c.card, c.faceUp));
  return up;
}

type Kind = 'move' | 'draw' | 'undo' | 'complete' | 'deal';
interface Plan { kind: Kind; rects: Map<string, DOMRect>; before: Board | null }

interface Drag {
  cards: Card[];
  els: HTMLElement[];
  from: Source;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  pointerId: number;
  active: boolean;
  home: DOMRect;
  zones: { to: Destination; rect: DOMRect; legal: boolean }[];
  target: Destination | null;
}

export function Solitaire() {
  useTitle('Solitaire');
  const [initial] = useState(loadGame);
  const [game, setGame] = useState(initial.game);
  const gameRef = useRef(game);
  gameRef.current = game;
  const [message, setMessage] = useState(HINT);
  const [dragView, setDragView] = useState<{ legal: string[]; over: string | null } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const pending = useRef<{ card: Card; at: number; timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);
  const newDialog = useRef<HTMLDialogElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const planRef = useRef<Plan | null>(initial.fresh ? { kind: 'deal', rects: new Map(), before: null } : null);
  const busyUntil = useRef(0);
  const cues = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wonLive = useRef(false);
  const [celebrating, setCelebrating] = useState(false);
  const [panel, setPanel] = useState(() => isWon(initial.game.board));
  const won = isWon(game.board);
  const now = useNow(game.startedAt !== null && !won);
  const time = game.startedAt === null ? 0 : (game.finishedAt ?? now) - game.startedAt;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game)); }
    catch { /* A full or unavailable store must not interrupt play. */ }
  }, [game]);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current.timer);
    cues.current.forEach(clearTimeout);
  }, []);
  /* Fit the board to the screen: the face-up step shrinks until the tallest
     pile ends above the bottom of the viewport, never below a rank's corner. */
  useLayoutEffect(() => {
    const board = boardRef.current!;
    const size = () => {
      /* Widest board whose top row plus a six-hidden, eleven-up pile fits. */
      const gap = parseFloat(getComputedStyle(board.querySelector('.sol-tableau')!).columnGap);
      const fit = (window.innerHeight - (board.getBoundingClientRect().top + window.scrollY) - 100) / (1.4 * 5.4);
      board.parentElement!.style.setProperty('--sol-w', `${Math.max(320, Math.floor(fit * 7 + gap * 6))}px`);
      const pile = board.querySelector('.sol-pile')!;
      const card = pile.getBoundingClientRect().width * 7 / 5;
      const top = pile.getBoundingClientRect().top + window.scrollY;
      const room = window.innerHeight - top - 16;
      const hiddenStep = parseFloat(getComputedStyle(board).getPropertyValue('--sol-hidden-step'));
      let step = card * 0.4;
      for (const p of game.board.tableau) {
        const hidden = p.filter((c) => !c.faceUp).length;
        const up = p.length - hidden - 1;
        if (up > 0) step = Math.min(step, (room - card - hidden * hiddenStep) / up);
      }
      board.style.setProperty('--sol-step', `${Math.round(Math.max(card * 0.33, step))}px`);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(board);
    window.addEventListener('resize', size);
    return () => { observer.disconnect(); window.removeEventListener('resize', size); };
  }, [game.board.tableau]);

  /* Play the change that was just rendered: every card that moved glides in
     from where it was, every card that changed side turns over. Runs after
     the fit above, so a pile that grew and tightened the step glides too. */
  useLayoutEffect(() => {
    const plan = planRef.current;
    planRef.current = null;
    const root = boardRef.current;
    if (!plan || !root) return;
    stopAll(root);
    if (reducedMotion()) return;
    const before = plan.before ? faces(plan.before) : null;
    const after = faces(game.board);
    const stock = root.querySelector('.sol-stock')!.getBoundingClientRect();
    const els = [...root.querySelectorAll<HTMLElement>('[data-card]')];
    const order = new Map<string, number>();
    if (plan.kind === 'deal') {
      let i = 0;
      for (let row = 0; row < 7; row++) {
        for (let pile = row; pile < 7; pile++) order.set(game.board.tableau[pile][row].card, i++);
      }
    } else if (plan.kind === 'complete') {
      const landed = game.board.foundations.flat().filter((c) => plan.before && !plan.before.foundations.flat().includes(c));
      landed.sort((a, b) => RANKS.indexOf(a[0]) - RANKS.indexOf(b[0]) || SUITS.indexOf(a[1] as typeof SUITS[number]) - SUITS.indexOf(b[1] as typeof SUITS[number]));
      landed.forEach((c, i) => order.set(c, i));
    }
    let end = 0;
    let moved = 0;
    for (const el of els) {
      const card = el.dataset.card!;
      const from = plan.kind === 'deal' ? (order.has(card) ? stock : null) : plan.rects.get(card) ?? null;
      const wasUp = plan.kind === 'deal' ? !order.has(card) && after.get(card) : before?.get(card);
      const isUp = after.get(card)!;
      let delay = 0;
      let z = 100 + moved;
      if (plan.kind === 'deal' || plan.kind === 'complete') {
        const i = order.get(card) ?? 0;
        delay = i * (plan.kind === 'deal' ? 25 : 60);
        z = 300 - i;
      } else if (from) {
        delay = moved * (plan.kind === 'draw' ? 45 : 18);
      }
      const duration = plan.kind === 'complete' ? 280 : GLIDE_MS;
      const landed = from ? glide(el, from, { delay, duration, z }) : 0;
      if (landed) moved++;
      end = Math.max(end, landed);
      if (wasUp !== undefined && wasUp !== isUp) {
        /* A card turned over in place waits for the card that uncovered it
           to start leaving; one that travels turns while it flies. */
        const at = landed ? delay + 30 : plan.kind === 'undo' ? 0 : 90;
        end = Math.max(end, turn(el, !isUp, at, landed ? Math.max(180, Math.min(TURN_MS, duration)) : TURN_MS));
      }
    }
    busyUntil.current = performance.now() + end;
  }, [game]);

  /* The win: wait for the last card to land, then the cascade and the
     panel. A board that was already won when the page opened just shows the
     panel. */
  useEffect(() => {
    if (!won) { setPanel(false); setCelebrating(false); return; }
    if (!wonLive.current) { setPanel(true); return; }
    wonLive.current = false;
    const quiet = reducedMotion();
    const wait = Math.max(0, busyUntil.current - performance.now()) + 80;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => {
      void sound.play('solWon');
      if (quiet) setPanel(true);
      else {
        setCelebrating(true);
        timers.push(setTimeout(() => setPanel(true), 1100));
      }
    }, wait));
    return () => timers.forEach(clearTimeout);
  }, [won]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = boardRef.current;
    if (!celebrating || !canvas || !root) return;
    const piles = gameRef.current.board.foundations;
    const launches: Launch[] = [];
    for (let r = 12; r >= 0; r--) {
      piles.forEach((pile) => {
        const card = pile[r];
        const el = card && root.querySelector<HTMLElement>(`[data-card="${card}"]`);
        if (el) launches.push({ card, el, rect: el.getBoundingClientRect() });
      });
    }
    return cascade(canvas, launches, getComputedStyle(root), (i) => {
      if (i % 3 === 0) void sound.play('solPlace', { rate: 1.1 + Math.random() * 0.1 });
    });
  }, [celebrating]);

  /* A sound now, or when the card it belongs to lands. */
  function cue(event: SoundEvent, at = 0, rate = jitter()) {
    if (at <= 0 || reducedMotion()) { void sound.play(event, { rate }); return; }
    const timer = setTimeout(() => {
      cues.current = cues.current.filter((t) => t !== timer);
      void sound.play(event, { rate });
    }, at);
    cues.current.push(timer);
  }

  function cancelTap() {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }

  function settle() {
    cues.current.forEach(clearTimeout);
    cues.current = [];
    setCelebrating(false);
    setPanel(false);
  }

  /* Every change to the board goes through here: measure, render, and the
     layout effect above plays the difference. Returns false for a move the
     rules refuse, so the caller can say no. */
  function commit(action: Action, kind: Kind, dropped = false): boolean {
    const prev = gameRef.current;
    const next = play(prev, action, Date.now());
    if (next === prev) return false;
    planRef.current = { kind, rects: measure(boardRef.current!), before: prev.board };
    gameRef.current = next;
    setGame(next);
    setMessage(HINT);
    if (!isWon(prev.board) && isWon(next.board)) wonLive.current = true;
    if (kind === 'undo') settle();
    const land = dropped ? 30 : GLIDE_MS - 40;
    const a = prev.board;
    const b = next.board;
    if (kind === 'draw') cue(a.stock.length ? 'solDraw' : 'solShuffle');
    else if (kind === 'complete') {
      const n = foundationCount(b) - foundationCount(a);
      for (let i = 0; i < n; i++) cue('solFoundation', i * 60 + 240, Math.min(1.4, 1 + i * 0.012));
    } else if (kind === 'undo') cue('solPlace', 120, 0.92);
    else {
      cue(foundationCount(b) > foundationCount(a) ? 'solFoundation' : 'solPlace', land, foundationCount(b) > foundationCount(a) ? 1.06 : jitter());
      if (hiddenCount(b) < hiddenCount(a)) cue('solFlip', land + 90);
    }
    return true;
  }

  function startNew() {
    cancelTap();
    settle();
    const next = newGame(Math.random, gameRef.current.drawCount);
    planRef.current = { kind: 'deal', rects: new Map(), before: null };
    gameRef.current = next;
    setGame(next);
    setMessage(HINT);
    cue('solShuffle');
    for (let i = 0; i < 28; i += 3) cue('solPlace', 160 + i * 25);
  }

  function elementsFor(cards: Card[]): HTMLElement[] {
    const root = boardRef.current!;
    return cards.map((c) => root.querySelector<HTMLElement>(`[data-card="${c}"]`)).filter((el): el is HTMLElement => !!el);
  }

  function refuse(card: Card, text: string) {
    const board = gameRef.current.board;
    const from = findSource(board, card);
    if (!reducedMotion()) shake(elementsFor(from ? cardsAt(board, from) : [card]));
    cue('solIllegal');
    setMessage(text);
  }

  function autoMove(card: Card, foundationOnly = false) {
    if (commit({ type: 'auto', card, foundationOnly }, 'move')) return;
    refuse(card, foundationOnly ? 'This card cannot go to a foundation yet.' : 'No move for this card. Try the stock or drag another card.');
  }

  function tap(card: Card, detail: number) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const previous = pending.current;
    if (detail > 1 || (previous?.card === card && Date.now() - previous.at < 300)) {
      cancelTap();
      autoMove(card, true);
      return;
    }
    if (previous) {
      clearTimeout(previous.timer);
      previous.run();
    }
    const run = () => autoMove(card);
    pending.current = {
      card, at: Date.now(), run,
      timer: setTimeout(() => { pending.current = null; run(); }, 300),
    };
  }

  function startDrag(e: PointerEvent<HTMLButtonElement>, card: Card) {
    if (!e.isPrimary || e.button !== 0 || won) return;
    suppressClick.current = false;
    const board = gameRef.current.board;
    const from = findSource(board, card);
    if (!from) return;
    const cards = cardsAt(board, from);
    const els = elementsFor(cards);
    if (!els.length) return;
    dragRef.current = {
      from, cards, els, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0,
      pointerId: e.pointerId, active: false, home: els[0].getBoundingClientRect(), zones: [], target: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.dx = e.clientX - d.startX;
    d.dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(d.dx, d.dy) < 6) return;
      d.active = true;
      cancelTap();
      const root = boardRef.current!;
      stopAll(root);
      d.home = d.els[0].getBoundingClientRect();
      const board = gameRef.current.board;
      d.zones = DESTINATIONS.map((to) => ({
        to, legal: canMove(board, d.from, to),
        rect: root.querySelector(`[data-drop="${dropId(to)}"]`)!.getBoundingClientRect(),
      }));
      d.els.forEach((el) => { el.dataset.lifted = ''; });
      root.dataset.dragging = '';
      setDragView({ legal: d.zones.filter((z) => z.legal).map((z) => dropId(z.to)), over: null });
      cue('solPickUp');
    }
    for (const el of d.els) el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
    const held = new DOMRect(d.home.x + d.dx, d.home.y + d.dy, d.home.width, d.home.height);
    let best: Destination | null = null;
    let most = 0;
    for (const z of d.zones) {
      if (!z.legal) continue;
      const area = overlap(held, z.rect);
      if (area > most) { most = area; best = z.to; }
    }
    if ((best && dropId(best)) !== (d.target && dropId(d.target))) {
      d.target = best;
      setDragView((v) => v && { ...v, over: best && dropId(best) });
    }
  }

  function endDrag(e: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.active) return;
    suppressClick.current = true;
    setDragView(null);
    delete boardRef.current!.dataset.dragging;
    const to = cancelled ? null : d.target;
    const release = () => d.els.forEach((el) => { el.style.transform = ''; delete el.dataset.lifted; });
    if (to && canMove(gameRef.current.board, d.from, to)) {
      /* Measured while still held, so the cards land from under the finger. */
      const rects = measure(boardRef.current!);
      release();
      if (commit({ type: 'move', from: d.from, to }, 'move', true)) {
        planRef.current = planRef.current && { ...planRef.current, rects };
        return;
      }
    }
    release();
    if (!reducedMotion()) d.els.forEach((el) => springBack(el, d.dx, d.dy));
    const held = new DOMRect(d.home.x + d.dx, d.home.y + d.dy, d.home.width, d.home.height);
    const missed = !cancelled && d.zones.some((z) => !z.legal && overlap(held, z.rect) > held.width * held.height * 0.25
      && !(d.from.kind === z.to.kind && 'pile' in d.from && d.from.pile === z.to.pile));
    if (missed) {
      cue('solIllegal');
      setMessage('That move does not fit. Try a card of the other colour, one rank higher.');
    }
  }

  function movable(board: Board, card: Card) {
    const from = findSource(board, card);
    return !!from && DESTINATIONS.some((to) => canMove(board, from, to));
  }

  function renderCard(card: Card, faceUp: boolean, interactive: boolean, style?: CSSProperties) {
    const face = <span className="sol-face"><PlayingCard card={card} still /></span>;
    if (!interactive) {
      return <span key={card} className="sol-covered" data-card={card} data-face={faceUp ? 'up' : 'down'} style={style} aria-hidden="true">{face}</span>;
    }
    return (
      <button
        key={card} type="button" className="sol-card" style={style} data-card={card} data-face="up"
        data-movable={!won && movable(board, card) ? '' : undefined}
        aria-label={cardName(card)} disabled={won}
        onClick={(e) => tap(card, e.detail)}
        onPointerDown={(e) => startDrag(e, card)} onPointerMove={moveDrag}
        onPointerUp={(e) => endDrag(e)} onPointerCancel={(e) => endDrag(e, true)}
        onLostPointerCapture={(e) => { if (dragRef.current) endDrag(e, true); }}
      >
        {face}
      </button>
    );
  }

  function dropState(to: Destination) {
    if (!dragView) return undefined;
    const id = dropId(to);
    if (dragView.over === id) return 'over';
    return dragView.legal.includes(id) ? 'legal' : undefined;
  }

  const { board } = game;
  const fan = game.drawCount;
  return (
    <LookContext.Provider value="v2">
      <main className="page wide stack solitaire">
        <div className="sol-heading">
          <h1 className="h1">Solitaire</h1>
          <div className="sol-controls">
          <button type="button" className="btn btn-secondary btn-lg" disabled={!game.history.length} onClick={() => { cancelTap(); commit({ type: 'undo' }, 'undo'); }}>Undo</button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={() => {
            cancelTap();
            if (board.moves > 0 && !won) newDialog.current?.showModal();
            else startNew();
          }}>New game</button>
          <label className="switch-row sol-draw"><input type="checkbox" className="switch" checked={game.drawCount === 3} onChange={(e) => {
            const count = e.target.checked ? 3 : 1;
            setGame((current) => { const next = play(current, { type: 'drawCount', count }, Date.now()); gameRef.current = next; return next; });
          }} />Draw 3</label>
          {canComplete(board) && <button type="button" className="btn btn-primary btn-lg" onClick={() => { cancelTap(); commit({ type: 'complete' }, 'complete'); }}>Complete game</button>}
          </div>
          <div className="sol-stats">
            <span><span className="num" data-moves>{board.moves}</span> moves</span>
            <span className="num" aria-label={`Time ${elapsed(time)}`} data-timer>{elapsed(time)}</span>
          </div>
        </div>
        <div className="sol-board" ref={boardRef} aria-label="Klondike board">
          <DeckSprite />
          <div className="sol-top">
            <div className="sol-cell">
              <button
                type="button" className="sol-stock sol-slot"
                aria-label={board.stock.length ? `Draw ${game.drawCount === 3 ? 'three cards' : 'one card'}, ${board.stock.length} in stock` : board.waste.length ? 'Redeal stock' : 'Stock empty'}
                disabled={won || (!board.stock.length && !board.waste.length)} onClick={() => { cancelTap(); commit({ type: 'draw' }, 'draw'); }}
              >
                {!board.stock.length && <span>{board.waste.length ? 'Redeal' : 'Empty'}</span>}
                {board.stock.map((card) => renderCard(card, false, false))}
              </button>
            </div>
            <div className="sol-cell">
              <div className="sol-waste sol-slot">
                {board.waste.map((card, i) => {
                  const k = Math.max(0, i - (board.waste.length - fan));
                  return renderCard(card, true, i === board.waste.length - 1, { left: `calc(${k} * var(--sp-1))` });
                })}
              </div>
            </div>
            <div aria-hidden="true" />
            {board.foundations.map((pile, i) => (
              <div className="sol-cell" key={SUITS[i]}>
                <div className="sol-slot sol-foundation" data-drop={`f${i}`} data-drop-state={dropState({ kind: 'foundation', pile: i })} aria-label={`${SUIT_NAMES[i]} foundation`}>
                  <svg className="sol-pip" aria-hidden="true" viewBox="0 0 100 100"><use href={`#pip-${SUITS[i]}`} /></svg>
                  {pile.map((card, j) => renderCard(card, true, j === pile.length - 1))}
                </div>
              </div>
            ))}
          </div>
          <div className="sol-tableau">
            {board.tableau.map((pile, i) => (
              <div
                className="sol-pile" key={i} data-drop={`t${i}`}
                data-drop-state={dropState({ kind: 'tableau', pile: i })} aria-label={`Tableau pile ${i + 1}`}
                style={{ '--sol-stack-offset': stackOffset(pile, Math.max(0, pile.length - 1)) } as CSSProperties}
              >
                <span className="sol-slot sol-empty">K</span>
                {pile.map((c, index) => renderCard(c.card, c.faceUp, c.faceUp, { top: stackOffset(pile, index) }))}
              </div>
            ))}
          </div>
          {won && panel && (
            <div className="sol-won card stack" role="dialog" aria-labelledby="sol-won-title">
              <h2 className="h1" id="sol-won-title">You won</h2>
              <p>All four foundations are complete. {board.moves} moves in {elapsed(time)}.</p>
              <button type="button" className="btn btn-primary btn-lg" onClick={startNew} autoFocus>Play again</button>
            </div>
          )}
        </div>
        {celebrating && <canvas className="sol-cascade" ref={canvasRef} aria-hidden="true" />}
        <div className="sol-status" role="status">
          {won ? <p className="muted">You won in {board.moves} moves.</p> : <p className="muted">{message}</p>}
        </div>
        <p className="muted sol-help">Tap a card to move it, or drag it to a pile. Double tap for a foundation.</p>
        <p className="muted sol-help">Stack cards in descending order, alternating red and black. Only kings go in empty piles. You can redeal as often as you like.</p>
        <dialog className="dlg" ref={newDialog} aria-labelledby="sol-new-title">
          <div className="dlg-body"><h2 className="dlg-title" id="sol-new-title">Start a new game?</h2><p>This replaces your current deal and resets the timer.</p></div>
          <div className="dlg-foot">
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => newDialog.current?.close()}>Keep playing</button>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => {
              newDialog.current?.close();
              startNew();
            }}>Start new game</button>
          </div>
        </dialog>
      </main>
    </LookContext.Provider>
  );
}
