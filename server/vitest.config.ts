import { defineConfig } from 'vitest/config';

/* Every server test file boots the app against the one test database, and a
   boot aborts whatever matches another file left playing. Files therefore run
   one at a time; tests inside a file still share nothing they did not set up. */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
