/* A persona nudges a bot's strategy away from its level's baseline, so two
   bots playing the same level do not play byte-identically. It is a small
   set of multipliers on named constants already in strategy.ts, not a
   second brain: `decide()` reads the same charts and the same hand strength
   number at every level, and a persona only stretches or squeezes a handful
   of thresholds around them.

   Every multiplier defaults to 1 (`NEUTRAL_PERSONA`), which is what `decide`
   uses when nothing is passed. Multiplying by exactly 1 changes nothing in
   IEEE754, which is what keeps `server/test/strategy.test.ts`'s byte-for-byte
   pin on level 4 intact without a persona-shaped carve-out in the strategy
   code itself. */

export type Archetype = 'nit' | 'station' | 'maniac' | 'tag' | 'lag' | 'tilter' | 'tourist';

export interface Persona {
  archetype: Archetype;
  // Widens or narrows the preflop percentile a bot will play, applied to the
  // percentile itself (see strategy.ts): >1 plays more hands, <1 fewer.
  looseness: number;
  // Scales every bet and raise's target size, applied inside `aggressive()`,
  // the one chokepoint every raise in strategy.ts passes through.
  aggression: number;
  // Scales the handful of named bluff-chance constants (a check-raise bluff,
  // a semi-bluff, a 3-bet bluff).
  bluffChance: number;
  // Scales how large a call a bot will make as a fraction of pot or stack.
  callCap: number;
}

export const NEUTRAL_PERSONA: Persona = {
  archetype: 'tag',
  looseness: 1,
  aggression: 1,
  bluffChance: 1,
  callCap: 1,
};

export const ARCHETYPES: Archetype[] = ['nit', 'station', 'maniac', 'tag', 'lag', 'tilter', 'tourist'];

/* One line per archetype: what a human would recognise it as at the table.
   Kept short and never shown as an insult: this is flavour for a profile
   or an internal readout, never table talk. */
export const ARCHETYPE_DESCRIPTIONS: Record<Archetype, string> = {
  nit: 'Plays a narrow, careful range and rarely raises without the goods.',
  station: 'Calls a lot, folds little, raises when the hand is unmistakable.',
  maniac: 'Loose and aggressive to a fault, raising and bluffing constantly.',
  tag: 'Tight-aggressive: a solid, unremarkable range played firmly.',
  lag: 'Loose-aggressive: a wide range played with real pressure.',
  tilter: 'Plays a bit too loose and a bit too aggressive, as if stung by the last hand.',
  tourist: 'Here for the weekend: a loose range played without much heat behind it.',
};

const BASE: Record<Archetype, Omit<Persona, 'archetype'>> = {
  nit: { looseness: 0.7, aggression: 0.75, bluffChance: 0.3, callCap: 0.7 },
  station: { looseness: 1.3, aggression: 0.7, bluffChance: 0.5, callCap: 1.4 },
  maniac: { looseness: 1.4, aggression: 1.5, bluffChance: 1.8, callCap: 1.2 },
  tag: { looseness: 1.0, aggression: 1.1, bluffChance: 1.0, callCap: 0.95 },
  lag: { looseness: 1.25, aggression: 1.35, bluffChance: 1.4, callCap: 1.05 },
  // A fixed profile rather than session state: real tilt swings hand to
  // hand, which would need a memory of how the last one went. This is the
  // steady-state a player leaning that way settles into instead: a bit
  // looser and a bit more aggressive than a TAG, all the time.
  tilter: { looseness: 1.15, aggression: 1.25, bluffChance: 1.3, callCap: 1.15 },
  tourist: { looseness: 1.1, aggression: 0.85, bluffChance: 0.8, callCap: 1.1 },
};

export function personaFor(archetype: Archetype): Persona {
  return { archetype, ...BASE[archetype] };
}

export type Rng = () => number;

// The archetype's multipliers, jittered +/-15% per bot so two bots sharing
// an archetype and a level still differ. Seeded and applied once at roster
// generation, not redrawn per hand.
export function jitteredPersona(archetype: Archetype, rng: Rng): Persona {
  const base = BASE[archetype];
  const nudge = (v: number) => Math.round(v * (0.85 + rng() * 0.3) * 1000) / 1000;
  return {
    archetype,
    looseness: nudge(base.looseness),
    aggression: nudge(base.aggression),
    bluffChance: nudge(base.bluffChance),
    callCap: nudge(base.callCap),
  };
}
