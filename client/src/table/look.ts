import { createContext, useContext } from 'react';

/* Which rendering of the felt this table draws. `v2` is the rework: SVG card
   faces, three-quarter chips, the action band. Every live table draws it; the
   mock defaults to `v1` so the footprint and screenshot suites keep measuring
   the felt they were written for, and takes ?v2=1. Once the suites move to v2,
   v1 and this file go. */
export type Look = 'v1' | 'v2';

export const LookContext = createContext<Look>('v1');

export const useLook = (): Look => useContext(LookContext);
