import {
  Cards, ChartLineUp, GridFour, Percent, Ranking, ShieldCheck, Timer, UsersThree,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

/* The reading order. The index lists these in this order, and every lesson
   points at the next one from it, so there is one place where the sequence
   lives and no lesson can point at a page that moved. */

export interface Lesson {
  slug: string;
  title: string;
  blurb: string;
  /* Decoration on the index card, the same way a sidebar section carries one:
     hidden from the reader, since the title beside it already says the name. */
  Icon: Icon;
  /* Where the lesson sends you when you have read it. A tool where one
     exists, the home page where the answer is to go and play. */
  practice: { to: string; label: string };
}

export const LESSONS: Lesson[] = [
  {
    slug: 'rules',
    title: 'How a hand plays',
    blurb: 'The deal, the blinds, the four streets and the showdown.',
    Icon: Cards,
    practice: { to: '/', label: 'Play a hand' },
  },
  {
    slug: 'hands',
    title: 'Hand rankings',
    blurb: 'Royal flush down to high card, and the kicker rule that settles ties.',
    Icon: Ranking,
    practice: { to: '/', label: 'Play a hand' },
  },
  {
    slug: 'positions',
    title: 'Position',
    blurb: 'Who acts when, heads-up and six handed, and why acting last is worth so much.',
    Icon: UsersThree,
    practice: { to: '/', label: 'Play a hand' },
  },
  {
    slug: 'odds',
    title: 'Pot odds and outs',
    blurb: 'Counting outs, the rule of two and four, and the price the pot is offering.',
    Icon: Percent,
    practice: { to: '/tools/odds', label: 'Train pot odds' },
  },
  {
    slug: 'ranges',
    title: 'Ranges',
    blurb: 'The 169 starting hands, the grid everyone draws them on, and the baseline chart this site scores against.',
    Icon: GridFour,
    practice: { to: '/tools/ranges', label: 'Open the range explorer' },
  },
  {
    slug: 'rating',
    title: 'How the rating works',
    blurb: 'Glicko-2 in plain words: 1500, the deviation, and why six-max is one rating period.',
    Icon: ChartLineUp,
    practice: { to: '/leaderboard', label: 'See the leaderboard' },
  },
  {
    slug: 'fair',
    title: 'Provably fair',
    blurb: 'The deck is committed to before it is dealt, and you can check it afterwards.',
    Icon: ShieldCheck,
    practice: { to: '/', label: 'Play a hand and verify it' },
  },
  {
    slug: 'formats',
    title: 'The two formats',
    blurb: 'The heads-up match, the six-max sit-and-go, the clock, and practice against bots.',
    Icon: Timer,
    practice: { to: '/', label: 'Start a match' },
  },
];

export function lessonBySlug(slug: string): Lesson | undefined {
  return LESSONS.find((l) => l.slug === slug);
}

export function nextLesson(slug: string): Lesson | undefined {
  return LESSONS[LESSONS.findIndex((l) => l.slug === slug) + 1];
}
