import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MODE_CHOICES, SPEED_CHOICES, SPEED_NAME, formatFor, rankedBanText } from '@opentable/protocol';
import type { ModeChoice, SpeedChoice } from '@opentable/protocol';
import { Lightning } from '@phosphor-icons/react/dist/icons/Lightning';
import { readPlayChoice, useSession } from '../net/session.tsx';
import { MODE_NAME, modeTabLabel, speedChoiceName } from '../ui/mode-tabs.tsx';
import { Segmented } from '../ui/segmented.tsx';
import { useNow } from '../ui/bits.tsx';
import { useTitle } from '../ui/title.ts';
import { modeBlurb, scheduleLine } from './home.tsx';
import './home.css';

/* Every format the site can deal, and the screen that exists so each one can
   say what it is before it is picked.

   The front page used to hold these three toggles. The first piece of
   feedback this site ever had was that a new player cannot tell "fast" from
   "standard" without clicking one to find out, so they moved here, where
   there is room for a sentence per option, and the front page kept one
   button. A search started here goes back to the front page to wait, because
   that is where the searching card lives and one copy of it is enough. */

/* The same line for a search that has not named one game. A promise cannot be
   made from a format when two of them would do, so it says what is being
   looked for and leaves the shape to the table that turns up: the blurb's
   whole job is that it never disagrees with the match it starts. */
function choiceBlurb(mode: ModeChoice, speed: SpeedChoice): string {
  if (mode !== 'any' && speed !== 'any') return modeBlurb(mode, speed);
  const size = mode === 'any' ? 'Six handed or heads-up' : MODE_NAME[mode];
  const pace = speed === 'any' ? ' at either speed' : `, ${SPEED_NAME[speed].toLowerCase()},`;
  return `${size}${pace}. Whichever table fills first.`;
}

/* What picking an option would mean, one line, carried on the option itself
   through `data-tip`. The speed tips are the schedule sentence off the real
   format rather than written out again, so a tip and the blurb under the
   button cannot disagree, and neither goes stale when a schedule is retuned. */
const ANY_TIP = 'Both. Whichever table fills first.';

function speedTip(speed: SpeedChoice): string {
  return speed === 'any' ? ANY_TIP : scheduleLine(formatFor('six-max', true, speed));
}

const MODE_TIP: Record<ModeChoice, string> = {
  'six-max': 'Six seats. Last player standing takes the table.',
  'heads-up': 'Two seats, one on one, played to a bust.',
  any: ANY_TIP,
};

const RANKED_TIP = 'Moves your Glicko-2 rating. This is the ladder.';
const CASUAL_TIP = 'Nothing moves. Bots fill any seat nobody takes.';

export function Play() {
  const { me, startQueue, offline, ready } = useSession();
  const nav = useNavigate();
  useTitle('Play');

  /* Opens on whatever was picked here last, which `startQueue` writes on every
     search. A player who has picked nothing gets the front page's game, so
     this screen and that button agree on a first visit. */
  const [last] = useState(() => readPlayChoice());
  const [mode, setMode] = useState<ModeChoice>(last?.mode ?? 'six-max');
  const [rated, setRated] = useState(last?.rated ?? true);
  const [speed, setSpeed] = useState<SpeedChoice>(last?.speed ?? 'standard');

  /* A walkout ban shuts the ranked door and nothing else, so the ranked
     option goes dead and the line says when it opens. Casual is still there:
     it is the room somebody serving one is meant to be able to play in. */
  const banUntil = me?.rankedBanUntil ?? null;
  const banNow = useNow(banUntil !== null, 1000);
  const rankedBanned = banUntil !== null && banUntil > banNow;
  const willBeRated = rated && !rankedBanned;

  return (
    <main className="page stack play-page">
      <section className="hero">
        <h1 className="h1">Play</h1>
        <p className="lede">
          Every table the site deals. Six handed or heads-up, fast or standard, ranked or casual.
        </p>
      </section>

      <div className="card play-panel">
        <div className="play-toggles">
          {/* Speed and table size can both say "any". With this few people
              playing, four queues of nearly nobody is a slower game than one
              wide search, so the widest of them is offered and a player
              narrows it only if they care. Ranked cannot: see `ModeChoice` in
              the protocol. */}
          <Segmented
            label="Speed"
            options={SPEED_CHOICES.map((sp) => ({
              value: sp,
              label:
                sp === 'fast' ? (
                  <>
                    <Lightning size={14} weight="fill" aria-hidden="true" />
                    {SPEED_NAME[sp]}
                  </>
                ) : (
                  speedChoiceName(sp)
                ),
              tip: speedTip(sp),
            }))}
            value={speed}
            onPick={(v) => setSpeed(v as SpeedChoice)}
          />
          <Segmented
            label="Ranked or casual"
            options={[
              { value: 'ranked', label: 'Ranked', tip: RANKED_TIP },
              { value: 'casual', label: 'Casual', tip: CASUAL_TIP },
            ]}
            value={willBeRated ? 'ranked' : 'casual'}
            onPick={(v) => setRated(v === 'ranked')}
            disabled={(v) => v === 'ranked' && rankedBanned}
          />
          <Segmented
            label="Table size"
            options={MODE_CHOICES.map((m) => ({ value: m, label: modeTabLabel(m), tip: MODE_TIP[m] }))}
            value={mode}
            onPick={(v) => setMode(v as ModeChoice)}
          />
        </div>

        <span className="muted">{choiceBlurb(mode, speed)}</span>
        {rankedBanned && <span className="muted">{rankedBanText(banUntil!, banNow)}</span>}

        <button
          type="button"
          className="btn btn-primary btn-lg play-go"
          disabled={!ready || offline}
          onClick={() => {
            startQueue(mode, willBeRated, speed);
            nav('/');
          }}
        >
          Play
        </button>
      </div>
    </main>
  );
}
