import { defineConfig } from 'vitest/config'

/**
 * Separate config used only by `npm run test:postgres` — see
 * vitest.devnet.config.ts's comment for why this needs its own file
 * rather than a shared `test/integration/**` glob. Scoped to just this
 * one file so it doesn't also require `anvil`/`forge` to be installed.
 */
export default defineConfig({
  // Silences a harmless Vite warning about eas-sdk's sourcemaps pointing
  // at TypeScript source not included in the published npm package —
  // cosmetic only, never affects test results.
  logLevel: 'error',
  test: {
    include: ['test/integration/postgresDevnet.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
