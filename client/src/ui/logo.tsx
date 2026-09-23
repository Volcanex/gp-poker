/* The EveryonePoker mark: a card diamond, four points with the sides drawn
   slightly in, the way a printed suit is. It replaced the spade with an EP cut
   out of it on 2026-09-23 ("for now"): the owner found the spade tacky.

   One single-colour path taking `currentColor`, so it comes out right on every
   theme with no per-theme rule. The viewBox is the ink exactly, so a consumer
   matches it to text by setting a height and trusting the box.

   These constants are the geometry's only home in the repo. `public/logo.svg`,
   the favicon, the icon PNGs and og.png are exports of them made by
   `node scripts/icons.mjs`; regenerate rather than edit, or they drift. The
   exports are white on black whatever the theme. */
export const LOGO_VIEWBOX = '0 0 40 52';
export const LOGO_PATH = 'M20 0Q27 13 40 26Q27 39 20 52Q13 39 0 26Q13 13 20 0Z';

/* Height only. Width is left to the aspect ratio. */
export function Logo({ height, className }: {
  height?: number | string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox={LOGO_VIEWBOX}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={LOGO_PATH} />
    </svg>
  );
}
