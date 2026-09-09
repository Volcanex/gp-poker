export type SoundEvent =
  | 'deal'
  | 'cardPlace'
  | 'bet'
  | 'call'
  | 'check'
  | 'fold'
  | 'chipsCollect'
  | 'yourTurn'
  | 'clockWarning'
  | 'tick'
  | 'readyCheck'
  | 'readyAccept'
  | 'handWon'
  | 'handLost'
  | 'matchWon'
  | 'matchLost'
  | 'chat'
  | 'click';

export const soundEvents: readonly SoundEvent[] = [
  'deal',
  'cardPlace',
  'bet',
  'call',
  'check',
  'fold',
  'chipsCollect',
  'yourTurn',
  'clockWarning',
  'tick',
  'readyCheck',
  'readyAccept',
  'handWon',
  'handLost',
  'matchWon',
  'matchLost',
  'chat',
  'click',
];
