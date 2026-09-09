import { banDurationText, banRemainingText, speedOf, walkoutBanMs } from '@opentable/protocol';
import type { ActionKind, Card, MatchFormat } from '@opentable/protocol';

export function actionText(a: ActionKind, v?: number): string {
  switch (a) {
    case 'f': return 'Fold';
    case 'x': return 'Check';
    case 'c': return v ? `Call ${v}` : 'Call';
    case 'b': return v ? `Bet ${v}` : 'Bet';
    case 'r': return v ? `Raise to ${v}` : 'Raise';
    case 'a': return 'All in';
  }
}

/* The seat's action square: what the player just did, as a verb and the
   figure it carries on a line of its own, and which of the three colours it
   takes. Bet, raise and all in are one colour because they all put money in;
   check and call are the quiet colour; fold is its own. */
export type ActionTone = 'bet' | 'call' | 'fold';

export function actionWords(a: ActionKind, v?: number): { word: string; amount: number | null; tone: ActionTone } {
  switch (a) {
    case 'f': return { word: 'Folds', amount: null, tone: 'fold' };
    case 'x': return { word: 'Checks', amount: null, tone: 'call' };
    case 'c': return { word: 'Calls', amount: v ?? null, tone: 'call' };
    case 'b': return { word: 'Bets', amount: v ?? null, tone: 'bet' };
    case 'r': return { word: 'Raises to', amount: v ?? null, tone: 'bet' };
    case 'a': return { word: 'All in', amount: v ?? null, tone: 'bet' };
  }
}

/* The stats box under the board: the blinds in play and, when they climb,
   how far off the next level is. `blindText` is the same fact as one line for
   the band's result and the summary. */
export function blindsRow(format: MatchFormat, blinds: { sb: number; bb: number }, hand: number): { blinds: string; next: string | null } {
  const stakes = `${blinds.sb}/${blinds.bb}`;
  if (format.levels.length <= 1) return { blinds: stakes, next: null };
  const per = Math.max(1, format.levelHands);
  const level = Math.min(format.levels.length - 1, Math.floor((hand - 1) / per));
  if (level >= format.levels.length - 1) return { blinds: `${stakes}, level ${level + 1}`, next: 'Top level' };
  const left = per - ((hand - 1) % per);
  return { blinds: `${stakes}, level ${level + 1}`, next: `In ${left} ${left === 1 ? 'hand' : 'hands'}` };
}

export function streetText(s: string): string {
  switch (s) {
    case 'pre': return 'Preflop';
    case 'flop': return 'Flop';
    case 'turn': return 'Turn';
    case 'river': return 'River';
    case 'showdown': return 'Showdown';
    default: return 'Hand over';
  }
}

/* A six-max match runs until one player has every chip, so its format carries
   no hand count and the header does not promise one. */
export function handText(hand: number, hands: number | null): string {
  return hands == null ? `Hand ${hand}` : `Hand ${hand} of ${hands}`;
}

/* The same two facts for a header 390 px wide. Both are rendered and CSS picks
   one, because the long form does not fit beside the seed and its controls, and
   the seed is the half of that header that matters. */
export function handTextShort(hand: number, hands: number | null): string {
  return hands == null ? `#${hand}` : `${hand}/${hands}`;
}

export function blindTextShort(blinds: { sb: number; bb: number }): string {
  return `${blinds.sb}/${blinds.bb}`;
}

/* The blinds as they stand, and where they are in the schedule. The numbers
   and the level both come from the view, which is the server's word for what
   is in play: a fast format climbs on elapsed match time, and counting hands
   here would print a level the table is not on.

   `level` is optional because a client can outlive the server it talks to,
   and a view without one belongs to a format whose level is a function of the
   hand number, which is what the fallback counts. How many hands are left of
   the level is only said when there is a hand basis to say it from. */
export function blindText(
  format: MatchFormat,
  blinds: { sb: number; bb: number },
  hand: number,
  level?: number
): string {
  const stakes = `blinds ${blinds.sb}/${blinds.bb}`;
  if (format.levels.length <= 1) return `Blinds ${blinds.sb}/${blinds.bb}`;
  const per = format.levelHands;
  const at =
    level ?? Math.min(format.levels.length - 1, Math.floor((hand - 1) / Math.max(1, per)));

  /* Two questions, and a schedule the player is not climbing answers no to
     both. The hand basis fires only when a level is shorter than the match;
     standard heads-up sets it to the whole 25, which can never come round.
     The clock basis is a level the player meets only on a fast table, where
     it is the whole idea; on a standard one it is a backstop half an hour
     away that a normal match ends long before, and printing "Level 1" for
     the whole of one is a schedule nobody is on. */
  const climbsOnHands = per > 0 && (format.hands === null || per < format.hands);
  const climbsOnClock = speedOf(format) === 'fast';
  if (!climbsOnHands && !climbsOnClock) {
    // A backstop that has actually fired is worth saying plainly: the blinds
    // moved, which is the fact, and there is no schedule to place it in.
    return `Blinds ${blinds.sb}/${blinds.bb}`;
  }
  if (at >= format.levels.length - 1) return `Level ${at + 1}, ${stakes}, top level`;
  if (!climbsOnHands) return `Level ${at + 1}, ${stakes}`;
  const left = per - ((hand - 1) % per);
  return `Level ${at + 1}, ${stakes}, next in ${left} ${left === 1 ? 'hand' : 'hands'}`;
}

/* Generated names are CamelCase (RedTiger, StealthyCyclone), so a plain
   ellipsis cuts a word in half and leaves "Stealth...". Dropping whole words
   from the end keeps the first one readable, which is the half people use to
   tell two players apart. */
export function shortName(name: string, max = 12): string {
  if (name.length <= max) return name;
  const words = name.split(/(?=[A-Z])/).filter(Boolean);
  if (words.length > 1) {
    let out = words[0];
    for (const w of words.slice(1)) {
      if (out.length + w.length > max) break;
      out += w;
    }
    if (out.length < name.length) return `${out.slice(0, max)}…`;
  }
  return `${name.slice(0, max)}…`;
}

export function ordinal(n: number): string {
  const teen = n % 100;
  const suffix = teen >= 11 && teen <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function shortHash(h: string, n = 10): string {
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

export function cardsOf(shown: Record<number, Card[]> | undefined, seat: number): Card[] | null {
  if (!shown) return null;
  return shown[seat] ?? null;
}

/* Whether a pair of cards is on the table face up. The server sends a hidden
   holding as two question marks and an absent one as null, so this is the one
   reading of "these cards are being shown" the felt has: at a showdown, and
   from the moment an all-in run-out closes the betting. A seat that folded
   stays hidden through a run-out, so it reads false here like any other. */
export function faceUp(cards: Card[] | null | undefined): boolean {
  return cards != null && cards.length === 2 && !cards.some((c) => c.startsWith('?'));
}

/* What a match is worth, in one word. A match is rated, casual or practice and
   never two of them, and the two places that say it in prose read it from here
   so they cannot drift from each other or from the badge on the feed. */
export function stakeWord(format: { rated: boolean; practice?: boolean }): 'rated' | 'casual' | 'practice' {
  if (format.practice) return 'practice';
  return format.rated ? 'rated' : 'casual';
}

/* The same word to open a sentence with. */
export function stakeName(format: { rated: boolean; practice?: boolean }): string {
  const word = stakeWord(format);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function stakeSentence(format: { rated: boolean; practice?: boolean }): string {
  const word = stakeWord(format);
  if (word === 'rated') return '';
  return word === 'practice'
    ? 'Practice match, no rating change.'
    : 'Casual match, no rating change.';
}

/* ------------------------------------------------------- leaving a match

   What the leave modal says a ranked walkout will cost. Pure and here rather
   than in the dialog, because it is the one sentence a player reads before
   they decide and it has to be testable without a browser.

   Every number in it comes out of `walkoutBanMs` in the protocol, which is
   the same table the server charges from, so the warning cannot promise a
   punishment that is not the one applied. */

const WALKOUT_COUNT = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function walkoutCount(n: number): string {
  return WALKOUT_COUNT[n] ?? ordinal(n);
}

export function leaveWarning(strikes: number, banUntil: number | null, now = Date.now()): string {
  /* Already serving one. Rare, because a ban closes the doors into ranked,
     but a match that started before the ban did is still a match somebody
     can leave, and the honest thing to say is when it ends. */
  if (banUntil !== null && banUntil > now) {
    return `You are banned from ranked for another ${banRemainingText(banUntil, now)}. Leaving now adds a strike to that.`;
  }
  const next = strikes + 1;
  const ban = walkoutBanMs(next);
  if (ban === 0) {
    const then = banDurationText(walkoutBanMs(next + 1));
    return `Leaving now counts as a walkout. A second one inside a day bans you from ranked for ${then}.`;
  }
  return `Leaving now is your ${walkoutCount(next)} walkout inside a day. That bans you from ranked for ${banDurationText(ban)}.`;
}
