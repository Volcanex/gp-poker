/* Untracked. The base config with the preview server this session runs itself
   on 4198, so a suite can be re-run without rebuilding between passes. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:4198' },
  webServer: undefined,
});
