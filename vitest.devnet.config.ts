import { defineConfig } from 'vitest/config'

/**
 * Separate config used only by `npm run test:devnet` — the default
 * vitest.config.ts excludes test/integration/ entirely (see its own
 * comment for why), so running that suite needs a config that doesn't.
 * Scoped to this one file (not a directory glob) so it doesn't also pull
 * in test/integration/postgresDevnet.test.ts — that one needs `docker`,
 * this one needs `anvil`/`forge`, and neither should require the other's
 * external dependency just to run its own suite. No other test file
 * matches this include pattern, so this can't accidentally widen what a
 * plain `npm test` picks up either.
 */
export default defineConfig({
  // Silences a harmless Vite warning about eas-sdk's sourcemaps pointing
  // at TypeScript source not included in the published npm package —
  // cosmetic only, never affects test results.
  logLevel: 'error',
  test: {
    include: ['test/integration/localAnvilDevnet.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
