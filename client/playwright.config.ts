import { defineConfig, devices } from '@playwright/test';

/* The table's ergonomics are the product, so they are tested the way a player
   meets them: a real browser, the built bundle, and the mock table, which needs
   no server at all. Every API call the suite touches is stubbed in e2e/table.ts,
   so a run is identical whether or not a dev server happens to be up. */
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  /* Two, not one per core: the screenshot states render a full page at 1920 in
     both themes, and four browsers doing that at once on this box start timing
     out on each other rather than on anything real. */
  workers: 2,
  reporter: [['list']],
  timeout: 90_000,
  expect: {
    timeout: 10_000,
    /* Diff under 0.1% of the shot, which catches a moved control and forgives
       a subpixel of text rasterisation. */
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', scale: 'css' },
  },
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
