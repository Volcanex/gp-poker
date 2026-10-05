export interface OutsOdds {
  next: number;
  river: number | null;
}

export function outsOdds(outs: number, boardCards: number): OutsOdds | null {
  if (boardCards !== 3 && boardCards !== 4) return null;
  const unseen = 52 - 2 - boardCards;
  return {
    next: outs / unseen,
    river: boardCards === 3
      ? 1 - ((unseen - outs) * (unseen - outs - 1)) / (unseen * (unseen - 1))
      : null,
  };
}

export function oddsAgainst(chance: number): string {
  return chance === 0 ? '∞ to 1' : `${((1 - chance) / chance).toFixed(1)} to 1`;
}
