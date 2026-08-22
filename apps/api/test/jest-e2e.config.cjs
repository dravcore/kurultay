const path = require('node:path');

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'mjs', 'cjs'],
  rootDir: __dirname,
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  setupFiles: [path.join(__dirname, 'setup-e2e.ts')],
  // Keep in sync with `apps/api/jest.config.cjs`, which explains each entry: the workspace
  // packages are read from `src`, never from a built (and possibly stale) `dist`, and the
  // `.js` suffix their NodeNext sources use on relative imports is stripped so Jest can
  // resolve them to `.ts`.
  moduleNameMapper: {
    '^@kurul/shared-types$': '<rootDir>/../../../packages/shared-types/src/index.ts',
    '^@kurul/auth-access$': '<rootDir>/../../../packages/auth-access/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(t|j|mj)sx?$': [
      require.resolve('ts-jest'),
      {
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          // ts-jest compiles each file on its own into the CommonJS module Jest executes.
          // `apps/api/tsconfig.json` now inherits NodeNext from the base config, which under
          // a CJS package resolves ESM-only dependencies through `require(esm)` — a thing
          // ts-jest's single-file output cannot express. Pinning the transform back to
          // classic CommonJS keeps the runtime honest; the type-level win of NodeNext is in
          // `pnpm typecheck` and `nest build`, which are unaffected by this override.
          module: 'CommonJS',
          moduleResolution: 'Node',
          // Same `paths` as `apps/api/jest.config.cjs`, for the same reason (see the note
          // there): ts-jest's type resolution must agree with `moduleNameMapper` above.
          paths: {
            '@kurul/shared-types': ['../../packages/shared-types/src/index.ts'],
            '@kurul/auth-access': ['../../packages/auth-access/src/index.ts'],
          },
        },
      },
    ],
  },
  // Keep in sync with `apps/api/jest.config.cjs`: better-auth >=1.6 and its dependency
  // chain (better-call -> rou3, nanostores) are ESM-only and must go through ts-jest, and so
  // are `file-type` and its chain (`@tokenizer/inflate`, `strtok3`, `token-types`,
  // `peek-readable`, `uint8array-extras`, `@borewit/text-codec`) — see the longer note in the
  // unit config, including why `@borewit` is on this list and why the `file-type`
  // `moduleNameMapper` both configs used to carry is gone as of v22.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores|file-type|@tokenizer|strtok3|token-types|peek-readable|uint8array-extras|@borewit|kysely)/)',
  ],
};
