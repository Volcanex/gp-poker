import { motion, useReducedMotion } from 'motion/react';
import type { Card } from '@opentable/protocol';
import { useLook } from './look.ts';

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
  const look = useLook();
  const hidden = card === '?' || card === '??' || (card != null && card.startsWith('?'));
  if (look === 'v2') {
    return <CardV2 card={card} index={index} dim={dim} still={still} best={best} flip={flip} origin={origin} hidden={hidden} reduced={reduced} />;
  }

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

/* ------------------------------------------------------------------- v2 */

/* The rework: two SVG faces on one element that turns in three dimensions.
   The face is a jumbo index, the rank large in the corner with its pip under
   it and one big pip low on the right, which reads at sixteen pixels on a
   phone seat and at a hundred and twenty in the hero's hand. The pips are
   paths from deck-sprite.tsx, so every suit is the same shape everywhere; the
   rank is text in the house face. The material is matte: a flat fill from the
   card tokens, a hairline edge, no highlight, no gloss.

   A card turned over at a showdown mounts back-first and rotates to its face,
   so the flip is one object turning where it lies. Everything animates by
   transform and opacity only. */
function CardV2({
  card, index, dim, still, best, flip, origin, hidden, reduced,
}: Required<Pick<PlayingCardProps, 'card' | 'index'>> & Omit<PlayingCardProps, 'card' | 'index'> & {
  hidden: boolean;
  reduced: boolean | null;
}) {
  if (card == null) return <span className="pcard pc" data-empty aria-hidden="true" />;

  const rank = hidden ? '' : card[0];
  const suit = hidden ? '' : card[1];
  const label = hidden ? 'Face down card' : `${RANK_NAME[rank] ?? rank} of ${SUIT_NAME[suit] ?? suit}`;
  const from = origin ?? { x: 0, y: -10 };
  const enter = reduced || still
    ? { initial: false as const }
    : flip
      ? {
          initial: { rotateY: 180 },
          animate: { rotateY: 0 },
          transition: { duration: 0.32, ease: [0.3, 0, 0.1, 1] as const, delay: index * 0.07 },
        }
      : {
          initial: { opacity: 0, x: from.x, y: from.y, scale: 0.94 },
          animate: { opacity: 1, x: 0, y: 0, scale: 1 },
          transition: { duration: 0.24, ease: [0.2, 0, 0, 1] as const, delay: index * 0.05 },
        };

  return (
    <motion.span
      className="pcard pc"
      data-suit={hidden ? undefined : suit}
      data-back={hidden ? '' : undefined}
      data-dim={dim ? '' : undefined}
      data-best={best ? '' : undefined}
      role="img"
      aria-label={label}
      {...enter}
    >
      {!hidden && (
        <svg className="pc-face" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
          <rect className="pc-paper" x="0.5" y="0.5" width="99" height="139" rx="8" />
          <text className="pc-rank" x="9" y="47" data-ten={rank === 'T' ? '' : undefined}>
            {rank === 'T' ? '10' : rank}
          </text>
          <use href={`#pip-${suit}`} x="9" y="55" width="25" height="25" />
          <use href={`#pip-${suit}`} x="42" y="76" width="50" height="50" />
        </svg>
      )}
      <svg className="pc-back" viewBox="0 0 100 140" aria-hidden="true" focusable="false">
        <rect className="pc-paper" x="0.5" y="0.5" width="99" height="139" rx="8" />
        <rect className="pc-hatch" x="8" y="8" width="84" height="124" rx="5" />
      </svg>
    </motion.span>
  );
}
