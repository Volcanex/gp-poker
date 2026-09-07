import { deckFromSeed, seedHash } from '@opentable/engine';
import type { Card } from '@opentable/protocol';

export interface Check {
  key: 'commitment' | 'deck';
  label: string;
  ok: boolean;
  detail: string;
}

export interface FairnessInput {
  seed: string;
  seedHash: string;
  seatCount: number;
  button: number;
  holes: Record<number, [string, string]> | null;
  board: string[];
}

/* Deals the hole cards the way the engine does: round robin from the seat left
   of the button, one card each, then the second card each. The board is the
   next five cards in deck order, no burns. See packages/engine/CLAUDE.md. */
export function dealFromDeck(deck: Card[], seatCount: number, button: number) {
  const holes: Record<number, [Card, Card]> = {};
  let i = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let k = 0; k < seatCount; k += 1) {
      const seat = (button + 1 + k) % seatCount;
      const card = deck[i];
      i += 1;
      if (round === 0) holes[seat] = [card, card];
      else holes[seat] = [holes[seat][0], card];
    }
  }
  return { holes, board: deck.slice(i, i + 5) };
}

/* Both checks run here in the browser, on the published seed. Nothing is taken
   on trust from the server: the commitment is rehashed and the deck is
   re-derived and re-dealt, then compared to what was recorded. */
export function verifyHand(input: FairnessInput): Check[] {
  const checks: Check[] = [];

  const computed = seedHash(input.seed);
  const commitmentOk = computed === input.seedHash;
  checks.push({
    key: 'commitment',
    label: 'The seed matches the hash published before the deal',
    ok: commitmentOk,
    detail: commitmentOk
      ? `sha256 of the seed is ${input.seedHash.slice(0, 16)}...`
      : `sha256 of the seed is ${computed.slice(0, 16)}..., the commitment was ${input.seedHash.slice(0, 16)}...`,
  });

  const dealt = dealFromDeck(deckFromSeed(input.seed), input.seatCount, input.button);
  const boardOk = input.board.every((c, i) => dealt.board[i] === c);
  const holesOk =
    input.holes == null
      ? false
      : Object.entries(input.holes).every(([seat, cards]) => {
          const mine = dealt.holes[Number(seat)];
          return mine != null && mine[0] === cards[0] && mine[1] === cards[1];
        });
  const deckOk = boardOk && holesOk;
  checks.push({
    key: 'deck',
    label: 'The deck from that seed deals these exact cards',
    ok: deckOk,
    detail: deckOk
      ? `${Object.keys(input.holes ?? {}).length * 2} hole cards and ${input.board.length} board cards reproduced in order`
      : !holesOk
        ? 'the hole cards do not match the deck this seed produces'
        : 'the board does not match the deck this seed produces',
  });

  return checks;
}
