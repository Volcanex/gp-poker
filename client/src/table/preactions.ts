import type { ActionKind, LegalActions, TableView } from '@opentable/protocol';

/* Pre-actions: the choice you make while it is somebody else's turn, fired the
   moment the action reaches you. They are the reason the dock is useful before
   your turn rather than a bar that says "waiting". */
export type PreAction = 'check-fold' | 'call-any' | 'fold-any';

export const PRE_ACTIONS: { key: PreAction; label: string }[] = [
  { key: 'check-fold', label: 'Check or fold' },
  { key: 'call-any', label: 'Call any' },
  { key: 'fold-any', label: 'Fold to any bet' },
];

/* What it would cost the viewer to call as the table stands. Read off the
   seats rather than off `legal`, which only exists on your own turn: a
   pre-action has to notice the price change while somebody else is acting. */
export function amountToCall(view: TableView): number {
  if (view.you == null) return 0;
  const mine = view.seats.find((s) => s.i === view.you);
  if (!mine) return 0;
  const high = view.seats.reduce((m, s) => Math.max(m, s.bet), 0);
  return Math.max(0, high - mine.bet);
}

/* The action a pill turns into once it is your turn, or null when the spot it
   was chosen for is gone. Fold to any bet checks when nobody bet, because that
   is what the words say: it folds *to a bet*. */
export function resolvePreAction(pre: PreAction, legal: LegalActions): ActionKind | null {
  const can = (a: ActionKind) => legal.actions.includes(a);
  switch (pre) {
    case 'check-fold':
      return can('x') ? 'x' : can('f') ? 'f' : null;
    case 'call-any':
      return can('c') ? 'c' : can('x') ? 'x' : null;
    case 'fold-any':
      if (legal.call > 0) return can('f') ? 'f' : null;
      return can('x') ? 'x' : null;
  }
}

/* A pill that assumed a price is void once the price moves. "Call any" and
   "fold to any bet" say what to do about a bet of any size, so only the one
   that assumed nobody would bet is cleared. */
export function survivesRaise(pre: PreAction): boolean {
  return pre !== 'check-fold';
}

/* Whether this hand is the last one of the match, so the dock counts down to
   the result rather than promising a hand that will never deal. Derived from
   the view the same way the server derives it: nobody can play on with an
   empty stack, and a heads-up match has a fixed length. */
export function isLastHand(view: TableView): boolean {
  const alive = view.seats.filter((s) => !s.out && s.stack > 0).length;
  if (alive < 2) return true;
  const { hands } = view.format;
  return hands != null && view.h >= hands;
}
