import { createContext, useContext } from 'react';

/* Which rendering of the felt this table draws. `v2` is the card and chip
   rework being spiked on the mock table: SVG card faces, three-quarter chips,
   the phone hero band. The context exists so the two can be looked at side by
   side while the old one is still the one people play on; once v2 is the only
   look, this file goes. */
export type Look = 'v1' | 'v2';

export const LookContext = createContext<Look>('v1');

export const useLook = (): Look => useContext(LookContext);
