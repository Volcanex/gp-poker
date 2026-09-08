/* Card pickers, shared by the two tools. Rank and suit are separate selects
   rather than a 52 button grid: it is two keystrokes either way, and a select
   is a control every browser already makes accessible. */

import { RANK_CHARS, SUIT_CHARS } from '@opentable/equity/cards';

export const SUIT_WORDS: Record<string, string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

export const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const RANKS_HIGH_FIRST = [...RANK_CHARS].reverse();
export const SUITS = [...SUIT_CHARS];

export function rankLabel(rank: string): string {
  return rank === 'T' ? '10' : rank;
}

export function CardPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (card: string) => void;
}) {
  return (
    <span className="picker">
      <span className="select-wrap">
        <select
          className="select"
          aria-label={`${label}, rank`}
          value={value[0]}
          onChange={(e) => onChange(`${e.target.value}${value[1]}`)}
        >
          {RANKS_HIGH_FIRST.map((r) => (
            <option key={r} value={r}>
              {rankLabel(r)}
            </option>
          ))}
        </select>
      </span>
      <span className="select-wrap">
        <select
          className="select"
          aria-label={`${label}, suit`}
          value={value[1]}
          onChange={(e) => onChange(`${value[0]}${e.target.value}`)}
        >
          {SUITS.map((s) => (
            <option key={s} value={s}>
              {SUIT_GLYPH[s]} {SUIT_WORDS[s]}
            </option>
          ))}
        </select>
      </span>
    </span>
  );
}

/* Reads a board the way a player would type it: "AhKd2c", "Ah Kd 2c", commas
   and case both fine. Returns null while the text is not yet a board, so a
   half typed card is not an error. */
export function readCards(text: string): string[] | null {
  const cleaned = text.replace(/[,\s]+/g, '');
  if (cleaned.length === 0) return [];
  if (cleaned.length % 2 !== 0) return null;
  const cards: string[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const rank = cleaned[i].toUpperCase();
    const suit = cleaned[i + 1].toLowerCase();
    if (!RANK_CHARS.includes(rank) || !SUIT_CHARS.includes(suit)) return null;
    const card = `${rank}${suit}`;
    if (cards.includes(card)) return null;
    cards.push(card);
  }
  return cards;
}
