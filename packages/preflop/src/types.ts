export type StackBucket = 'deep' | 'mid' | 'short' | 'push';

export type Spot = 'sb_open' | 'bb_vs_open' | 'sb_vs_3bet' | 'bb_vs_4bet' | 'sb_push' | 'bb_vs_push';

export type DecisionAction = 'aggr' | 'passive' | 'fold';

export interface Decision {
  seat: number;
  spot: Spot;
  bucket: StackBucket;
  hand: string;
  action: DecisionAction;
  best: DecisionAction;
  evLost: number;
  inRange: boolean;
}

export interface SeatStats {
  vpip: boolean;
  pfr: boolean;
  aggr: number;
  passive: number;
  faced3bet: boolean;
  foldTo3bet: boolean;
}
