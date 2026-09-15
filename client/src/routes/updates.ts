/* The update log the home page shows. Newest entry first; the top one names
   the version the site is running. Player-facing wording only: an entry is
   what changed at the table, not which file changed. */

export type Update = {
  version: string;
  date: string;
  notes: string[];
};

export const UPDATES: Update[] = [
  {
    version: 'Alpha 1.0',
    date: '15 Sep 2026',
    notes: [
      'The bots play a harder game',
      'The pot collects before the next street deals',
      'Seat cards carry avatars, chips and ratings again',
      'The felt narrates the hand along its bottom edge',
    ],
  },
];
