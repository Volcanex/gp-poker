import type { SoundEvent } from '../../events.ts';
import type { SoundModule } from '../../sound-types.ts';
import { click8bitSound } from './click-8bit.ts';
import { select001Sound } from './select-001.ts';
import { select002Sound } from './select-002.ts';
import { select003Sound } from './select-003.ts';
import { select004Sound } from './select-004.ts';
import { confirmation001Sound } from './confirmation-001.ts';
import { jump8bitSound } from './jump-8bit.ts';
import { jinglesNes01Sound } from './jingles-nes-01.ts';
import { jinglesNes02Sound } from './jingles-nes-02.ts';

export const arcade: {
  id: string;
  name: string;
  description: string;
  sounds: Record<SoundEvent, SoundModule | null>;
} = {
  id: 'arcade',
  name: 'Arcade',
  description: '8-bit blips, mostly short clicks with jingles saved for wins.',
  sounds: {
    deal: click8bitSound,
    cardPlace: click8bitSound,
    bet: select001Sound,
    call: select002Sound,
    check: click8bitSound,
    fold: select003Sound,
    chipsCollect: select004Sound,
    yourTurn: confirmation001Sound,
    clockWarning: jump8bitSound,
    tick: click8bitSound,
    readyCheck: confirmation001Sound,
    readyAccept: jinglesNes01Sound,
    handWon: jinglesNes01Sound,
    handLost: click8bitSound,
    matchWon: jinglesNes02Sound,
    matchLost: click8bitSound,
    chat: click8bitSound,
    click: click8bitSound,
    solPickUp: click8bitSound,
    solPlace: click8bitSound,
    solFlip: select002Sound,
    solDraw: select001Sound,
    solFoundation: select004Sound,
    solIllegal: select003Sound,
    solShuffle: confirmation001Sound,
    solWon: jinglesNes02Sound,
  },
};

export default arcade;
