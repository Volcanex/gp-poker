import { defineConfig } from 'vitest/config';

/* The unit tests are the pure logic under src/test. The e2e specs next door are
   Playwright's, and vitest's default glob picks up a *.spec.ts anywhere, which
   is how it ended up trying to run a browser suite in node. */
export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
  },
});
