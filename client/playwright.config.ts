import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';

/* One port per worktree. This repo is worked in from a dozen git worktrees at
   once, and they all used to preview on 4173: whoever started first won, and
   everybody else's tests ran against that build without saying so. The port
   is derived from the checkout's own path, so two worktrees cannot collide
   and a worktree always gets the same port twice running. */
const PORT = 4173 + (parseInt(createHash('sha1').update(process.cwd()).digest('hex').slice(0, 6), 16) % 400);

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
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    /* Safe only because the port is this worktree's own. With a fixed port it
       was not: `reuseExistingServer` would happily adopt a preview server
       another worktree had started, so a suite silently tested somebody
       else's build, and killing their run pulled the server out from under
       this one mid-suite. Both happened. */
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
