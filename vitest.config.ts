import { defineConfig } from 'vitest/config'

/**
 * Only exists to exclude test/integration/ from the default `npm test`
 * run — see test/integration/localAnvilDevnet.test.ts's own header
 * comment for why. That test shells out to the real `anvil`/`forge`
 * binaries and does real (if local) transactions, so it's slower and
 * has an external-tool dependency the fast/hermetic default suite
 * doesn't need. Run it explicitly via `npm run test:devnet`.
 *
 * The non-integration entries below are vitest's own documented
 * defaults, repeated here because setting `test.exclude` at all replaces
 * them rather than merging with them.
 */
export default defineConfig({
  // Silences a harmless Vite warning: @ethereum-attestation-service/eas-sdk
  // ships sourcemaps pointing at TypeScript source that isn't included in
  // the published npm package. Cosmetic only — never affects test results.
  logLevel: 'error',
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'test/integration/**',
    ],
  },
})
