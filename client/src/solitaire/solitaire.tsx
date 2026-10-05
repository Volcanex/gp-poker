import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { Card } from '@opentable/protocol';
import { DeckSprite } from '../table/deck-sprite.tsx';
import { PlayingCard } from '../table/playing-card.tsx';
import { LookContext } from '../table/look.ts';
import { elapsed, useNow } from '../ui/bits.tsx';
import { useTitle } from '../ui/title.ts';
import {
  canComplete, canMove, cardsAt, findSource, isWon, newGame, play, restoreGame, SUITS,
} from './klondike.ts';
import type { Action, Destination, Game, Source, TableauCard } from './klondike.ts';
import './solitaire.css';

const STORAGE_KEY = 'ot.solitaire.v1';
const SUIT_NAMES = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const RANK_NAMES: Record<string, string> = { A: 'Ace', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King' };
const cardName = (card: Card) => `${RANK_NAMES[card[0]] ?? card[0]} of ${SUIT_NAMES[SUITS.indexOf(card[1] as typeof SUITS[number])].toLowerCase()}`;
const stackOffset = (pile: TableauCard[], index: number) => {
  const below = pile.slice(0, index);
  const hidden = below.filter((c) => !c.faceUp).length;
  return `calc(${hidden} * var(--sol-hidden-step) + ${below.length - hidden} * var(--sol-step))`;
};

function loadGame(): Game {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = restoreGame(raw);
      if (saved) return saved;
    }
  } catch { /* Storage may be unavailable in a private browser. */ }
  return newGame();
}

interface Drag {
  cards: Card[];
  from: Source;
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  step: number;
  pointerId: number;
  active: boolean;
  target: Destination | null;
}

function destinationAt(x: number, y: number): Destination | null {
  const value = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
  return value ? { kind: value[0] === 'f' ? 'foundation' : 'tableau', pile: Number(value.slice(1)) } : null;
}

export function Solitaire() {
  useTitle('Solitaire');
  const [game, setGame] = useState(loadGame);
  const [message, setMessage] = useState('Build the four foundations from ace to king.');
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const pending = useRef<{ card: Card; at: number; timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);
  const newDialog = useRef<HTMLDialogElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const won = isWon(game.board);
  const now = useNow(game.startedAt !== null && !won);
  const time = game.startedAt === null ? 0 : (game.finishedAt ?? now) - game.startedAt;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game)); }
    catch { /* A full or unavailable store must not interrupt play. */ }
  }, [game]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current.timer); }, []);
  useLayoutEffect(() => {
    const board = boardRef.current!;
    const size = () => {
      const width = board.querySelector('.sol-pile')!.getBoundingClientRect().width;
      board.style.setProperty('--sol-step', `${Math.max(40, Math.ceil(width * 0.84 / 4) * 4)}px`);
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  function cancelTap() {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }

  function act(action: Action) {
    cancelTap();
    setGame((current) => play(current, action, Date.now()));
    setMessage('Build the four foundations from ace to king.');
  }

  function autoMove(card: Card, foundationOnly = false) {
    setGame((current) => play(current, { type: 'auto', card, foundationOnly }, Date.now()));
    const from = findSource(game.board, card);
    const next = play(game, { type: 'auto', card, foundationOnly }, Date.now());
    setMessage(next === game && from
      ? foundationOnly ? 'This card cannot go to a foundation yet.' : 'No move for this card. Try the stock or drag another card.'
      : 'Build the four foundations from ace to king.');
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
    const from = findSource(game.board, card);
    if (!from) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const step = parseFloat(getComputedStyle(boardRef.current!).getPropertyValue('--sol-step'));
    dragRef.current = {
      from, cards: cardsAt(game.board, from), startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      width: rect.width, step, pointerId: e.pointerId, active: false, target: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const active = current.active || Math.hypot(e.clientX - current.startX, e.clientY - current.startY) >= 8;
    if (!active) return;
    cancelTap();
    const target = destinationAt(e.clientX, e.clientY);
    const next = { ...current, active, x: e.clientX, y: e.clientY, target };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag(e: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    if (!current.active) return;
    suppressClick.current = true;
    const to = cancelled ? null : destinationAt(e.clientX, e.clientY);
    if (to && canMove(game.board, current.from, to)) act({ type: 'move', from: current.from, to });
    else setMessage('That move does not fit. Try a card of the other colour, one rank higher.');
  }

  function renderCard(card: Card, style?: CSSProperties) {
    return (
      <button
        key={card} type="button" className="sol-card" style={style} data-card={card}
        aria-label={cardName(card)} disabled={won}
        onClick={(e) => tap(card, e.detail)}
        onPointerDown={(e) => startDrag(e, card)} onPointerMove={moveDrag}
        onPointerUp={(e) => endDrag(e)} onPointerCancel={(e) => endDrag(e, true)}
        onLostPointerCapture={(e) => { if (dragRef.current) endDrag(e, true); }}
      >
        <PlayingCard card={card} still />
      </button>
    );
  }

  function dropState(to: Destination) {
    if (!drag || !canMove(game.board, drag.from, to)) return undefined;
    return drag.target?.kind === to.kind && drag.target.pile === to.pile ? 'over' : 'legal';
  }

  const { board } = game;
  return (
    <LookContext.Provider value="v2">
      <main className="page wide stack solitaire">
        <div className="sol-heading">
          <h1 className="h1">Solitaire</h1>
          <div className="sol-stats">
            <span><span className="num" data-moves>{board.moves}</span> moves</span>
            <span className="num" aria-label={`Time ${elapsed(time)}`} data-timer>{elapsed(time)}</span>
          </div>
        </div>
        <div className="sol-controls">
          <button type="button" className="btn btn-secondary btn-lg" disabled={!game.history.length} onClick={() => act({ type: 'undo' })}>Undo</button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={() => {
            cancelTap();
            if (board.moves > 0 && !won) newDialog.current?.showModal();
            else setGame(newGame(Math.random, game.drawCount));
          }}>New game</button>
          <label className="switch-row sol-draw"><input type="checkbox" className="switch" checked={game.drawCount === 3} onChange={(e) => act({ type: 'drawCount', count: e.target.checked ? 3 : 1 })} />Draw 3</label>
          {canComplete(board) && <button type="button" className="btn btn-primary btn-lg" onClick={() => act({ type: 'complete' })}>Complete game</button>}
        </div>
        <p className="muted sol-help">Tap a card to move it, or drag it to a pile. Double tap for a foundation.</p>
        <div className="sol-board" ref={boardRef} aria-label="Klondike board">
          <DeckSprite />
          <div className="sol-top">
            <div className="sol-cell">
              <span className="sol-label">Stock</span>
              <button
                type="button" className="sol-stock sol-slot"
                aria-label={board.stock.length ? `Draw ${game.drawCount === 3 ? 'three cards' : 'one card'}, ${board.stock.length} in stock` : board.waste.length ? 'Redeal stock' : 'Stock empty'}
                disabled={won || (!board.stock.length && !board.waste.length)} onClick={() => act({ type: 'draw' })}
              >
                {board.stock.length ? <PlayingCard card="??" still /> : <span>{board.waste.length ? 'Redeal' : 'Empty'}</span>}
              </button>
            </div>
            <div className="sol-cell">
              <span className="sol-label">Waste</span>
              <div className="sol-waste sol-slot">
                {board.waste.slice(-game.drawCount).map((card, i, visible) => (
                  i === visible.length - 1
                    ? renderCard(card, { left: `calc(${i} * var(--sp-1))` })
                    : <span className="sol-covered" key={card} style={{ left: `calc(${i} * var(--sp-1))` }}><PlayingCard card={card} still /></span>
                ))}
              </div>
            </div>
            <div aria-hidden="true" />
            {board.foundations.map((pile, i) => (
              <div className="sol-cell" key={SUITS[i]}>
                <span className="sol-label">{SUIT_NAMES[i]}</span>
                <div className="sol-slot sol-foundation" data-drop={`f${i}`} data-drop-state={dropState({ kind: 'foundation', pile: i })} aria-label={`${SUIT_NAMES[i]} foundation`}>
                  <svg className="sol-pip" aria-hidden="true" viewBox="0 0 100 100"><use href={`#pip-${SUITS[i]}`} /></svg>
                  {!!pile.length && renderCard(pile[pile.length - 1])}
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
                {pile.map((c, index) => c.faceUp
                  ? renderCard(c.card, { top: stackOffset(pile, index) })
                  : <span className="sol-covered" key={c.card} style={{ top: stackOffset(pile, index) }}><PlayingCard card="??" still /></span>)}
              </div>
            ))}
          </div>
          {drag && (
            <div className="sol-drag" style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width, '--sol-drag-step': `${drag.step}px` } as CSSProperties} aria-hidden="true">
              {drag.cards.map((card, i) => <span key={card} style={{ top: `calc(${i} * var(--sol-drag-step))` }}><PlayingCard card={card} still /></span>)}
            </div>
          )}
        </div>
        <div className="sol-status" role="status">
          {won ? <div className="card stack"><h2 className="h2">You won</h2><p>All four foundations are complete. {board.moves} moves in {elapsed(time)}.</p></div> : <p className="muted">{message}</p>}
        </div>
        <p className="muted sol-help">Stack cards in descending order, alternating red and black. Only kings go in empty piles. You can redeal as often as you like.</p>
        <dialog className="dlg" ref={newDialog} aria-labelledby="sol-new-title">
          <div className="dlg-body"><h2 className="dlg-title" id="sol-new-title">Start a new game?</h2><p>This replaces your current deal and resets the timer.</p></div>
          <div className="dlg-foot">
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => newDialog.current?.close()}>Keep playing</button>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => {
              newDialog.current?.close();
              setGame(newGame(Math.random, game.drawCount));
              setMessage('Build the four foundations from ace to king.');
            }}>Start new game</button>
          </div>
        </dialog>
      </main>
    </LookContext.Provider>
  );
}
