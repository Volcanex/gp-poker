/* Ambient types for untyped test/runtime dependencies. Neither ships a .d.ts. */

declare module 'phe' {
  export function evaluateCards(cards: string[]): number;
  export function evaluateCardsFast(cards: string[]): number;
  export function handRank(value: number): number;
  export const rankDescription: string[];
}

declare module 'pokersolver' {
  class Hand {
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    cards: unknown[];
  }
  const pokersolver: { Hand: typeof Hand };
  export default pokersolver;
}
