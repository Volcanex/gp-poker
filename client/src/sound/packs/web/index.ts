import type { SoundEvent } from '../../events.ts';
import type { SoundModule } from '../../sound-types.ts';
import { dealSound } from './deal.ts';
import { cardPlaceSound } from './card-place.ts';
import { betSound } from './bet.ts';
import { callSound } from './call.ts';
import { checkSound } from './check.ts';
import { foldSound } from './fold.ts';
import { chipsCollectSound } from './chips-collect.ts';
import { yourTurnSound } from './your-turn.ts';
import { clockWarningSound } from './clock-warning.ts';
import { tickSound } from './tick.ts';
import { readyCheckSound } from './ready-check.ts';
import { readyAcceptSound } from './ready-accept.ts';
import { handWonSound } from './hand-won.ts';
import { handLostSound } from './hand-lost.ts';
import { matchWonSound } from './match-won.ts';
import { matchLostSound } from './match-lost.ts';
import { chatSound } from './chat.ts';
import { clickSound } from './click.ts';
import { solPickUpSound } from './sol-pick-up.ts';
import { solFlipSound } from './sol-flip.ts';
import { solDrawSound } from './sol-draw.ts';

export const web: {
  id: string;
  name: string;
  description: string;
  sounds: Record<SoundEvent, SoundModule | null>;
} = {
  id: 'web',
  name: 'Old web',
  description: 'Blips and chimes from the dial-up years.',
  sounds: {
    deal: dealSound,
    cardPlace: cardPlaceSound,
    bet: betSound,
    call: callSound,
    check: checkSound,
    fold: foldSound,
    chipsCollect: chipsCollectSound,
    yourTurn: yourTurnSound,
    clockWarning: clockWarningSound,
    tick: tickSound,
    readyCheck: readyCheckSound,
    readyAccept: readyAcceptSound,
    handWon: handWonSound,
    handLost: handLostSound,
    matchWon: matchWonSound,
    matchLost: matchLostSound,
    chat: chatSound,
    click: clickSound,
    solPickUp: solPickUpSound,
    solFlip: solFlipSound,
    solDraw: solDrawSound,
    solPlace: checkSound,
    solFoundation: cardPlaceSound,
    solIllegal: tickSound,
    solShuffle: dealSound,
    solWon: matchWonSound,
  },
};

export default web;
