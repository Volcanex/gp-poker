/* The EveryonePoker mark: a spade with an EP cut out of it.

   One path, with the letterforms as real holes (fill-rule evenodd), so the
   mark is a single colour and the page shows through the counters. That is
   what lets it take `currentColor` and come out right on both themes, where
   the drawn artwork (a black spade with white letters painted on top) went
   invisible on the dark ground.

   Two corrections to the drawn artwork, both deliberate:

   - The spade closed on an implicit straight line, a dead level 126 unit edge
     that read as a machine cut under otherwise organic curves. The close is
     now an explicit shallow curve, so the stem flares into a pedestal.
   - The P's bowl was a solid wedge against an E made of two tapered strokes,
     which is what made the mark look right-heavy. The bowl is now a ring: the
     drawn outline with a copy of itself scaled to 0.54 about its own centre
     sitting inside it, which under evenodd fills the middle back in. That is
     what a P's bowl actually is, and it holds its shape down to about 40px
     where the solid wedge closed up into a blob.

   `solid` drops the counters entirely, for sizes where even the ring closes
   up: below roughly 20px the E's strokes are under a pixel each. A solid
   spade still reads as the same mark.

   The spade is symmetric to within antialiasing: row midpoints average 499.6
   of a perfect 499.5 on a 1000px raster.

   These constants are the geometry's only home in the repo. `public/logo.svg`,
   the favicon and the icon PNGs are exports of them; regenerate rather than
   edit, or they drift. Cropped from Main 01 Artboard 1.svg, whose 1920x1080
   artboard was almost entirely whitespace: this viewBox is the ink exactly,
   with zero slack on all four sides. */
export const LOGO_VIEWBOX = '0 0 473.01 511.82';
export const LOGO_TRANSFORM = 'translate(-697.96 -207.52)';
export const LOGO_PATH = 'M997.38,719.34c0,0,8.85-7.63,5.82-14.31c-2.03-4.46-4.32-9.7-7.65-18.1c-25.49-64.25-32.46-94.85-33.74-111.89 c-1.1-14.62,9.25-24.82,17.71-17.51c29.54,25.55,61.69,45.51,95.23,59.08c13.6,5.5,27.64,9.99,41.81,9.3 c14.18-0.69,28.06-8.1,38.69-20.7c22.03-26.1,17.38-61.79,7.32-91.43c-10.06-29.64-28.45-52.24-46.52-73.69 c-57.79-68.64-117.7-135.29-165.31-217.17c-1.35-2.33-3.84-6-6.46-9.72c-5.03-7.16-12.65-7.6-18.01-1.05 c-3.14,3.83-6.27,7.59-8.09,10.71c-47.61,81.88-107.52,148.53-165.31,217.17c-18.07,21.46-36.46,44.05-46.52,73.69 c-10.06,29.64-14.71,65.33,7.32,91.43c10.63,12.6,24.52,20.01,38.69,20.7c14.18,0.69,28.21-3.8,41.81-9.3 c33.54-13.56,65.69-33.53,95.23-59.08c8.45-7.31,18.81,2.89,17.71,17.51c-1.28,17.04-8.25,47.64-33.74,111.89 c-3.33,8.39-5.62,13.64-7.64,18.09c-3.04,6.68,5.82,14.32,5.82,14.32 C 905,711.26 964,711.26 997.38,719.34 M790.66,465.25c18.69-32.37,51.34-61.7,86.81-73.36c9.73-3.2,16.18-1.35,16.18-1.35 c2.19,0,11.03,3.31,5.43,15.71c-10.36,22.9-54.73,42.04-55.46,42.42c0,0-40.92,17.87-51.52,21.1c-1.26,0.38-2.49-0.66-2.32-1.97 C789.88,467.03,790.11,466.2,790.66,465.25z M900.84,485.8c-0.01,3.89-1.54,7.61-4.25,10.34c-12.02,12.05-46.64,39.81-70.64,52.97 c-33.73,18.49-56.57,26.91-65.97,20.55c-14.57-9.85-12.69-30.99,1.5-47.52c5.47-6.37,18.48-11.31,26.21-14.37 c11.77-4.66,52.9-23.63,64.12-29.56c15.73-8.3,41.14-25.77,48.22-32.31c0.32-0.3,0.83-0.08,0.84,0.36 C900.94,451.88,900.88,475.23,900.84,485.8z M969.55,486.64c-1.84-2.07-2.86-4.76-2.86-7.57c0.04-13.98,0.2-64.11,0.2-77.5c0-17.7,52.03,15.04,76.92,37.96 c28.8,26.53,80.41,90.9,52.2,115.37c-11.01,9.56-56.46-17.24-62.48-20.19C1004.9,520.65,978.15,496.31,969.55,486.64z M999.86,482.08 c-0.99,-1.12,-1.54,-2.57,-1.54,-4.09 c0.02,-7.55,0.11,-34.62,0.11,-41.85 c0.00,-9.56,28.10,8.12,41.54,20.50 c15.55,14.33,43.42,49.09,28.19,62.30 c-5.95,5.16,-30.49,-9.31,-33.74,-10.90 C1018.95,500.45,1004.50,487.31,999.86,482.08 Z';
export const LOGO_SOLID_PATH = 'M997.38,719.34c0,0,8.85-7.63,5.82-14.31c-2.03-4.46-4.32-9.7-7.65-18.1c-25.49-64.25-32.46-94.85-33.74-111.89 c-1.1-14.62,9.25-24.82,17.71-17.51c29.54,25.55,61.69,45.51,95.23,59.08c13.6,5.5,27.64,9.99,41.81,9.3 c14.18-0.69,28.06-8.1,38.69-20.7c22.03-26.1,17.38-61.79,7.32-91.43c-10.06-29.64-28.45-52.24-46.52-73.69 c-57.79-68.64-117.7-135.29-165.31-217.17c-1.35-2.33-3.84-6-6.46-9.72c-5.03-7.16-12.65-7.6-18.01-1.05 c-3.14,3.83-6.27,7.59-8.09,10.71c-47.61,81.88-107.52,148.53-165.31,217.17c-18.07,21.46-36.46,44.05-46.52,73.69 c-10.06,29.64-14.71,65.33,7.32,91.43c10.63,12.6,24.52,20.01,38.69,20.7c14.18,0.69,28.21-3.8,41.81-9.3 c33.54-13.56,65.69-33.53,95.23-59.08c8.45-7.31,18.81,2.89,17.71,17.51c-1.28,17.04-8.25,47.64-33.74,111.89 c-3.33,8.39-5.62,13.64-7.64,18.09c-3.04,6.68,5.82,14.32,5.82,14.32 C 905,711.26 964,711.26 997.38,719.34';

/* Height only. The mark is 473 x 512, so pinning both axes to one number
   letterboxes it inside its own box and reintroduces the whitespace the crop
   removed. Width is left to the aspect ratio. */
export function Logo({ height, solid = false, className }: {
  height?: number | string;
  solid?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox={LOGO_VIEWBOX}
      height={height}
      role="img"
      aria-label="EveryonePoker"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        transform={LOGO_TRANSFORM}
        d={solid ? LOGO_SOLID_PATH : LOGO_PATH}
      />
    </svg>
  );
}
