import { defineConfig } from 'vitest/config'

/**
 * Separate config used only by `npm run test:postgres` — see
 * vitest.devnet.config.ts's comment for why this needs its own file
 * rather than a shared `test/integration/**` glob. Scoped to just this
 * one file so it doesn't also require `anvil`/`forge` to be installed.
 */
export default defineConfig({
  test: {
    include: ['test/integration/postgresDevnet.test.ts'],
    testTimeout: 60_000,
  },
})
