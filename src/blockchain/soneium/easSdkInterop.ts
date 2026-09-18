/**
 * The installed @ethereum-attestation-service/eas-sdk has no
 * "type": "module" in its package.json (its ESM build re-exports named
 * imports from CJS-only lodash, which needs this). That makes vitest
 * and plain Node/tsx resolve the package differently: vitest loads the
 * real ESM build directly, with working named exports but no `default`;
 * Node/tsx treats it as CommonJS, so its static named-export detection
 * misses some exports (e.g. `SchemaEncoder` throws "does not provide an
 * export named" under a plain named import), but always exposes the
 * full CJS `module.exports` as `default`.
 *
 * A namespace import resolves under both: prefer `ns.default` when
 * present (Node/tsx), fall back to the namespace itself (vitest). Test
 * mocks provide both shapes for the same reason.
 */
export function resolveEasSdkModule<T extends object>(ns: T & { default?: T }): T {
  return ns.default ?? ns
}
