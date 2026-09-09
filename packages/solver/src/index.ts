export {
  NUM_CARDS,
  NUM_COMBOS,
  cardIndex,
  cardOf,
  comboIndex,
} from './cards.js';

export {
  COMBO_PERCENTILE,
  blendRanges,
  chartRange,
  cloneRange,
  emptyRange,
  rangeFromPercentiles,
  regionWeight,
  removeBlocked,
  widen,
} from './range.js';
export type { Range } from './range.js';

export { accumulateShowdown, foldValues, projectRange, rankBoard, universeOf } from './showdown.js';
export type { RankedBoard, Universe } from './showdown.js';

export { DEFAULT_BET_SIZES, DEFAULT_RAISE_CAP, DEFAULT_RAISE_SIZES, buildTree } from './tree.js';
export type { Act, ActionLabel, DecisionNode, Node, Tree, TreeSpec } from './tree.js';

export { Cfr } from './cfr.js';
export type { CfrOptions, ShowdownEvaluator } from './cfr.js';

export {
  FLOP_LEAF_DISCOUNT,
  FLOP_RUNOUTS,
  RUNOUT_WINDOW,
  TURN_LEAF_DISCOUNT,
  finishSubgame,
  frequenciesFor,
  fullRunoutEvaluator,
  leafDiscountFor,
  prepareSubgame,
  solveSubgame,
} from './solve.js';
export type { PreparedSubgame, SolveResult, SubgameSpec } from './solve.js';

export {
  BASE_PRIOR,
  RangeTracker,
  emptyStats,
  foldToBet,
  filterByAction,
  passivity,
  populationRange,
  positionRange,
  preflopRange,
  priorWeight,
  ranksWithinRange,
  strengthOnBoard,
} from './opponent.js';
export type { Aggression, AggressionKind, OpponentStats, Position, PreflopStep } from './opponent.js';

export { SolverBot, runInline } from './bot.js';
export type { Decision, Rng, SolveRunner } from './bot.js';
