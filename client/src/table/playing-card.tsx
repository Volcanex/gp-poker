import { motion, useReducedMotion } from 'motion/react';
import type { Card } from '@opentable/protocol';

const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANK_NAME: Record<string, string> = {
  A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten',
  '9': 'nine', '8': 'eight', '7': 'seven', '6': 'six',
  '5': 'five', '4': 'four', '3': 'three', '2': 'two',
};

export interface PlayingCardProps {
  card: Card | null; // null draws the empty slot that holds the board's width
  index?: number; // stagger position within its group
  dim?: boolean; // folded, mucked, or a board card the winning hand did not use
  still?: boolean; // skip the deal, the card was already on the table
  best?: boolean; // one of the five that made the winning hand
  flip?: boolean; // turned face up in place at a showdown rather than dealt
  origin?: { x: number; y: number }; // px the card is dealt from, relative to where it lands
}

/* Bespoke: g-system has no playing card. Composed only from g tokens. Red
   suits use --danger-text purely as the palette's red; nothing destructive in
   this app is red, so the meaning colour is not overloaded. */
export function PlayingCard({ card, index = 0, dim, still, best, flip, origin }: PlayingCardProps) {
  const reduced = useReducedMotion();
  const hidden = card === '?' || card === '??' || (card != null && card.startsWith('?'));

  if (card == null) return <span className="pcard" data-empty aria-hidden="true" />;

  const rank = hidden ? '' : card[0];
  const suit = hidden ? '' : card[1];
  const label = hidden ? 'Face down card' : `${RANK_NAME[rank] ?? rank} of ${SUIT_NAME[suit] ?? suit}`;

  /* Around a ring the cards come out of the middle of the table, so each seat
     is dealt along its own line. Stacked, they drop in as they always have.
     A card turned over at a showdown does neither: it flips where it lies, so
     nothing about the seat moves while the hand is being read. */
  const from = origin ?? { x: 0, y: -10 };
  const enter = reduced || still
    ? { initial: false as const }
    : flip
      ? {
          initial: { rotateY: 90, opacity: 0.4 },
          animate: { rotateY: 0, opacity: 1 },
          transition: { duration: 0.18, ease: [0.2, 0, 0, 1] as const, delay: index * 0.06 },
        }
      : {
          initial: { opacity: 0, x: from.x, y: from.y, scale: 0.96 },
          animate: { opacity: 1, x: 0, y: 0, scale: 1 },
          transition: { duration: 0.22, ease: [0.2, 0, 0, 1] as const, delay: index * 0.05 },
        };

  return (
    <motion.span
      className="pcard"
      data-suit={hidden ? undefined : suit}
      data-back={hidden ? '' : undefined}
      data-dim={dim ? '' : undefined}
      data-best={best ? '' : undefined}
      role="img"
      aria-label={label}
      {...enter}
    >
      {!hidden && (
        <>
          <span className="rank">{rank === 'T' ? '10' : rank}</span>
          <span className="suit" aria-hidden="true">{SUIT_GLYPH[suit] ?? suit}</span>
        </>
      )}
    </motion.span>
  );
}
