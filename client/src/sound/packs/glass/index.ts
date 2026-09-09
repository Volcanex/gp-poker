import type { SoundEvent } from '../../events.ts';
import type { SoundModule } from '../../sound-types.ts';
import { glass001Sound } from './glass-001.ts';
import { glass002Sound } from './glass-002.ts';
import { glass003Sound } from './glass-003.ts';
import { glass004Sound } from './glass-004.ts';
import { glass005Sound } from './glass-005.ts';
import { glass006Sound } from './glass-006.ts';
import { impactGlassLight000Sound } from './impact-glass-light-000.ts';
import { impactGlassLight001Sound } from './impact-glass-light-001.ts';
import { impactGlassLight002Sound } from './impact-glass-light-002.ts';
import { impactGlassLight003Sound } from './impact-glass-light-003.ts';
import { impactGlassLight004Sound } from './impact-glass-light-004.ts';
import { jinglesPizzi00Sound } from './jingles-pizzi-00.ts';
import { impactBellHeavy000Sound } from './impact-bell-heavy-000.ts';
import { jinglesSteel05Sound } from './jingles-steel-05.ts';

export const glass: {
  id: string;
  name: string;
  description: string;
  sounds: Record<SoundEvent, SoundModule | null>;
} = {
  id: 'glass',
  name: 'Glass',
  description: 'Quiet, glassy chimes, like an old desktop notification.',
  sounds: {
    deal: glass001Sound,
    cardPlace: impactGlassLight000Sound,
    bet: glass002Sound,
    call: glass003Sound,
    check: impactGlassLight001Sound,
    fold: glass004Sound,
    chipsCollect: impactGlassLight002Sound,
    yourTurn: glass005Sound,
    clockWarning: glass006Sound,
    tick: impactGlassLight004Sound,
    readyCheck: glass005Sound,
    readyAccept: jinglesPizzi00Sound,
    handWon: jinglesPizzi00Sound,
    handLost: impactGlassLight003Sound,
    matchWon: impactBellHeavy000Sound,
    matchLost: jinglesSteel05Sound,
    chat: impactGlassLight004Sound,
    click: impactGlassLight004Sound,
  },
};

export default glass;
