import type { Decision } from './types.js';

export interface Summary {
  evLost: number;
  accuracy: number;
  count: number;
}

export function summarise(decisions: Decision[]): Summary {
  const count = decisions.length;
  const evLost = decisions.reduce((sum, d) => sum + d.evLost, 0);
  const accuracy = count === 0 ? 100 : Math.round(100 * Math.max(0, 1 - evLost / (count * 2)) * 10) / 10;
  return { evLost: Math.round(evLost * 1000) / 1000, accuracy, count };
}
