import type { Card, LoggedAction } from '@opentable/protocol';
import type { HandConfig, HandState } from './types.js';
import { IllegalAction } from './types.js';
import { createHand } from './deal.js';
import { apply } from './betting.js';

export function replay(config: HandConfig, actions: LoggedAction[]): HandState[] {
  const states: HandState[] = [createHand(config)];
  for (const logged of actions) {
    const prev = states[states.length - 1];
    if (prev.street === 'done') {
      throw new IllegalAction('cannot apply an action to a finished hand');
    }
    const next = apply(prev, logged.s, logged.v !== undefined ? { a: logged.a, v: logged.v } : { a: logged.a });
    states.push(next);
  }
  return states;
}

export function visibleCards(state: HandState, viewerSeat: number | null): (Card[] | null)[] {
  return state.seats.map((s, i) => {
    if (viewerSeat !== null && i === viewerSeat) return s.cards;
    if (state.result && state.result.shown[i]) return state.result.shown[i];
    if (s.cards) return ['?', '?'];
    return null;
  });
}
