import type { SoundEvent } from '../../events.ts';
import type { SoundModule } from '../../sound-types.ts';
import { cardSlide1Sound } from './card-slide-1.ts';
import { cardPlace1Sound } from './card-place-1.ts';
import { cardPlace2Sound } from './card-place-2.ts';
import { chipLay1Sound } from './chip-lay-1.ts';
import { chipLay2Sound } from './chip-lay-2.ts';
import { cardShove1Sound } from './card-shove-1.ts';
import { chipsCollide1Sound } from './chips-collide-1.ts';
import { notificationPopSound } from './notification-pop.ts';
import { tick001Sound } from './tick-001.ts';
import { successChimeSound } from './success-chime.ts';
import { drop001Sound } from './drop-001.ts';
import { drop004Sound } from './drop-004.ts';
import { jinglesHit01Sound } from './jingles-hit-01.ts';
import { clickSoftSound } from './click-soft.ts';

export const felt: {
  id: string;
  name: string;
  description: string;
  sounds: Record<SoundEvent, SoundModule | null>;
} = {
  id: 'felt',
  name: 'Felt',
  description: 'Real foley: cards, chips and cloth on a poker table.',
  sounds: {
    deal: cardSlide1Sound,
    cardPlace: cardPlace1Sound,
    bet: chipLay1Sound,
    call: chipLay2Sound,
    check: cardPlace2Sound,
    fold: cardShove1Sound,
    chipsCollect: chipsCollide1Sound,
    yourTurn: notificationPopSound,
    clockWarning: tick001Sound,
    tick: tick001Sound,
    readyCheck: notificationPopSound,
    readyAccept: successChimeSound,
    handWon: successChimeSound,
    handLost: drop001Sound,
    matchWon: jinglesHit01Sound,
    matchLost: drop004Sound,
    chat: clickSoftSound,
    click: clickSoftSound,
  },
};

export default felt;
