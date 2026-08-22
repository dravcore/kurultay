/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'mjs', 'cjs'],
  rootDir: 'src',
  // `test/helpers/*.ts` (e.g. `auth.ts`, used by every `*.e2e-spec.ts`) lives outside
  // `src` on purpose — it's test-only code, not part of the shipped API — but its slug/
  // email uniqueness logic (`buildUniqueSlug`, `uniqueEmail`, `uniqueSuffix`; see the
  // doc comment on `uniqueSuffix` for why it exists — #173) is worth covering with a
  // fast, DB-free unit test rather than only indirectly through e2e runs. Extending
  // `roots` (discovery only — `rootDir` above still governs module resolution/coverage)
  // lets `test/helpers/*.spec.ts` run under the ordinary `pnpm test` alongside `src`'s
  // unit tests, without pulling in the `*.e2e-spec.ts` files next to it (those don't
  // match `testRegex` below: it requires a literal `.spec.ts`, not `.e2e-spec.ts`).
  roots: ['<rootDir>', '<rootDir>/../test/helpers'],
  testRegex: '.*\\.spec\\.ts$',
  // The two workspace packages resolve through their `package.json` `exports` to `dist/`,
  // which is git-ignored and only exists after a build. Tests must never depend on that: a
  // fresh checkout has no `dist`, and a stale one is worse, because it silently runs last
  // week's enums against this week's service. Both specifiers are pointed at the packages'
  // `src/index.ts` instead, so Jest compiles the same source `pnpm typecheck` reads.
  //
  // Those sources are NodeNext-style and import each other with a `.js` suffix
  // (`export * from './enums.js'`), which Jest's CommonJS resolver takes literally. The
  // second entry strips the suffix from every relative specifier and lets Jest pick the
  // extension from `moduleFileExtensions` instead. That is lossless for the files that were
  // already `.js` (`src/generated/prisma/index.js` does `require('./runtime/client.js')`;
  // `js` is first in the extension list, so the same file is found), and it is what makes
  // `./enums.js` reach `enums.ts`. `src/workspace-packages.spec.ts` asserts both mappings hold.
  // Keep in sync with `apps/api/test/jest-e2e.config.cjs`.
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
          // `moduleNameMapper` above tells Jest's resolver where `@kurul/*` lives; this tells
          // the TypeScript resolver the same thing, because ts-jest's type resolution follows
          // tsconfig, not the mapper. Today it changes nothing observable: `tsconfig.base.json`
          // sets `isolatedModules: true`, ts-jest 29 reads that as "transpile only", and a
          // transpile never looks a module up. Forcing `isolatedModules: false` in this block
          // with `dist` deleted is how the entry was proven: without it every spec importing a
          // shared type fails on TS2307, with it they pass. `paths` is resolved against the
          // directory of the tsconfig ts-jest finds (`apps/api`), so no `baseUrl` is needed.
          paths: {
            '@kurul/shared-types': ['../../packages/shared-types/src/index.ts'],
            '@kurul/auth-access': ['../../packages/auth-access/src/index.ts'],
          },
        },
      },
    ],
  },
  // better-auth >=1.6 is ESM-only, and so is the dependency chain it pulls in
  // (better-call -> rou3, nanostores). Jest runs CommonJS, so every one of these has to be
  // handed to ts-jest instead of being skipped as a plain `node_modules` require.
  //
  // `file-type` v21 is ESM-only for the same reason and reaches us through
  // `attachment-mime.ts`'s `await import('file-type')`. Its own chain is listed too:
  // `@tokenizer/inflate`, `strtok3`, `token-types`, `uint8array-extras`, plus `peek-readable`
  // underneath `strtok3` and `@borewit/text-codec` underneath `token-types`.
  // `@tokenizer/inflate` in particular is not optional — it carries the OOXML sniffing that
  // gives a `.docx`/`.xlsx`/`.pptx` its own media type, so leaving it out makes office uploads
  // fail as a 415 that reads like a wrong MIME rule rather than a transform gap. `@borewit` is
  // on this list because the suite named it, not because the chain was guessed: the run that
  // followed adding the rest failed with `Unexpected token 'export'` in
  // `@borewit/text-codec/lib/index.js`. Extend the list the same way — run it, read the package
  // the error names, add that one. Keep in sync with `apps/api/test/jest-e2e.config.cjs`.
  //
  // `kysely` arrived the same way and is worth naming, because the version that brought it
  // was a *patch*: `better-auth@1.6.27` added it to its own chain, and two suites that had
  // nothing to do with the change stopped parsing. A dependency allowlist maintained by hand
  // does not break when we change something; it breaks when somebody else does.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(jose|better-auth|@better-auth|uuidv7|@noble|better-call|@better-fetch|rou3|nanostores|file-type|@tokenizer|strtok3|token-types|peek-readable|uint8array-extras|@borewit|kysely)/)',
  ],
  // No `moduleNameMapper` for `file-type`, and the reason is worth keeping because it was
  // needed until this bump.
  //
  // `file-type@21`'s `exports` map offered `import` and `module-sync` and no `require`
  // condition at all, so Jest's CommonJS resolver — which asks for `require`/`default` —
  // answered `Cannot find module 'file-type'` even though the package was installed. The fix
  // was to map the specifier straight at the file that map would have chosen,
  // `file-type/node`.
  //
  // `file-type@22` collapsed the whole map to `{ types, default }`: the `./node` and `./core`
  // subpaths are gone, so the old mapping stopped resolving — and because it ran inside
  // `require.resolve` at config load, it took the entire suite down before a single test could
  // run, rather than failing the one file that imports the package. A `default` condition is
  // also exactly what the CJS resolver was missing, so Jest now finds the package on its own
  // and the mapping has nothing left to do. Deleted rather than repointed: an indirection that
  // no longer indirects is a thing the next reader has to disprove.
  //
  // `transformIgnorePatterns` above still lists `file-type` — the entry it resolves to is ESM
  // either way, and that has not changed.
  collectCoverageFrom: ['**/*.(t|j)s', '!**/generated/**'],
  coveragePathIgnorePatterns: ['/generated/'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Floor set a few points below the measured baseline, so CI fails on real regressions without
  // being so tight that routine refactors trip it.
  //
  // Baseline history, all `pnpm --filter @kurul/api test:cov`, stmts/branch/funcs/lines:
  //
  //   2026-08-09  57.19 / 48.29 / 59.68 / 58.12
  //   2026-08-14  77.86 / 69.31 / 79.64 / 79.24  after closing the workspace/activity/label/
  //                                              common-pipes-and-decorators cold zones tracked
  //                                              as audit finding QA-03
  //   2026-08-15  76.51 / 66.64 / 78.82 / 77.76  on `develop` — measured twice, independently,
  //                                              agreeing to four digits
  //
  // **The 2026-08-15 baseline is lower than the one before it, and the floor did not move.**
  // P3-2 (#206, #207) added checklist code, `collectCoverageFrom: ['**/*.(t|j)s']` counted it
  // automatically, and nobody re-measured — so the recorded baseline claimed roughly 3 points of
  // headroom over the branch floor while the real figure was **0.64**. That is worth stating
  // plainly, because the instruction below reads as symmetric and is not:
  //
  //   - Baseline moves **up**: re-measure, then raise the floor to a few points under the *new*
  //     number rather than under the old one.
  //   - Baseline moves **down**: re-measure and **record it here**. Do not lower the floor to
  //     restore the margin. The margin shrinking is the signal; lowering the floor deletes the
  //     signal and keeps the cause. A floor is only lowered on a deliberate, argued decision,
  //     never as bookkeeping after a drop.
  //
  // For reference, the attachment work (P3-1 tasks 1-4) measured 77.08 / 67.33 / 79.66 / 78.39,
  // i.e. it pulled the baseline back up rather than down. That is the expected shape for a new
  // module and not a reason to re-cut the floor either.
  //
  //   2026-08-15  77.56 / 67.96 / 79.61 / 78.85  after P3-1 tasks 5-8 (attachment service,
  //                                              controller, download path) — measured on three
  //                                              consecutive runs, identical to four digits
  //
  // The branch margin over the floor is back to 1.96 points from the 0.64 recorded above. The
  // floor is left where it is, for the same reason tasks 1-4 left it: a new module arriving with
  // its own tests raises the average without saying anything about the zones the floor watches.
  //
  //   2026-08-15  78.03 / 68.46 / 80.00 / 79.29  `develop` at b13fbf5, i.e. after #221 landed.
  //                                              Measured on this branch with `src/import`
  //                                              temporarily moved aside, which reproduces
  //                                              `develop` exactly: the importer is this
  //                                              branch's only addition under `src`.
  //   2026-08-15  78.65 / 69.54 / 80.66 / 79.99  after P3-3 tasks 1/3/4/5/6 (the Trello export
  //                                              reader and the label-colour mapping) — three
  //                                              consecutive runs, identical to four digits
  //
  // Up again, and the floor is left alone again, for the third time and for the same reason: the
  // two files this added are pure functions with 100% function coverage, so the average moved
  // without a single one of the cold zones the floor watches getting warmer. Branch margin is now
  // 3.54 points. If a later item wants to raise the floor, the number to raise it against is a
  // measurement taken *after* the cold zones are covered, not this one.
  //
  //   2026-08-15  78.06 / 69.15 / 79.57 / 79.09  after P3-11 (OpenAPI specification and `/docs`)
  //                                              — three consecutive runs, identical to four
  //                                              digits
  //
  // **Down, and recorded rather than accommodated**, per the asymmetry above. The cause is
  // `src/openapi/`: 35 response-schema classes with no runtime behaviour to exercise, plus
  // `openapi.document.ts` and `generate-openapi.ts`, which run under `nest build` and the CI
  // drift gate rather than under Jest. Only `serve-openapi.ts`'s exposure decision is unit
  // tested, because it is the only part of the directory where being wrong changes what a
  // deployment publishes. The floor does not move: 0.59 points of the P3-3 margin are gone and
  // that is the signal, not something to erase — but nothing the floor watches got colder, and
  // the branch margin is still 3.15 points.
  //
  //   2026-08-16  74.70 / 66.44 / 76.54 / 75.66  P3-11 rebased onto a `develop` carrying P3-4
  //                                              through P3-9. **Below the floor on three of
  //                                              four.** Measured in CI, reproduced locally.
  //
  // The entry above said the margin shrinking was the signal. This is what the signal was for.
  // Nothing about `src/openapi/` changed; the denominator did, when six other items landed and
  // the 3.15-point cushion that was absorbing an untested module stopped existing. A drop that
  // only shows up when someone else's work lands is still this module's drop.
  //
  //   2026-08-16  76.11 / 67.89 / 78.11 / 77.13  after testing `src/openapi/` — three
  //                                              consecutive runs, identical to four digits
  //
  // **Recovered by covering the cause, and no file is excluded from the denominator.** Three
  // options were measured rather than argued:
  //
  //   - excluding `generate-openapi.ts` alone        75.46 / 66.87 / 77.25 / 76.46
  //   - excluding it and `openapi.document.ts`       76.40 / 67.97 / 78.32 / 77.45
  //   - testing the module, excluding nothing        76.11 / 67.89 / 78.11 / 77.13
  //
  // The last one is within a rounding error of the second and beats the first outright, so the
  // exclusion buys about three tenths of a point. That is not worth what it costs:
  // `apps/web/vitest.config.ts` already states the rule in this repository's own words — *an
  // excluded file is an invisible one* — and excluding a file to restore a margin is the same
  // move as lowering the floor with one indirection in front of it.
  //
  // The tempting argument for exclusion was that `pnpm openapi:check` regenerates the whole
  // document on every CI build and byte-compares it, which is a stronger instrument than a unit
  // test. It is — for the paths a *green* run walks. It is blind exactly where the risk is:
  // `openapi.document.ts`'s two guards (`assertPathsExist`, the `UUID_PATH_PARAMS` membership
  // test) throw, so a passing gate never executes them, and they are the code that makes it safe
  // to restate a routing fact as a hard-coded list. The gate proves the lists are right today;
  // only a test proves the thing that is supposed to notice when they stop being right does.
  // `openapi.document.ts` is now 96.49% statements / 82.35% branches / 100% functions, and
  // `serve-openapi.ts` — the file that decides whether an unauthenticated console is published
  // in production — is 100% across the board, mount and all.
  //
  // `generate-openapi.ts` stays counted at 0% and stays in. It is the one file with a real
  // exclusion argument (argv, two `fs` calls, and a container boot, all of which `openapi:check`
  // runs on every build), and the floor clears with a 1.11-point margin without making it. An
  // argument you do not need to make is one you should not make. Its only untested logic — the
  // sentence printed when the gate fires, which a green run can never reach — was moved to
  // `openapi/snapshot.ts` and tested there.
  //
  // The floor still does not move. Margins are 1.11 / 1.89 / 1.11 / 1.13, and they are now
  // margins over a measurement that includes every file, which is the only kind worth having.
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 66,
      functions: 77,
      lines: 76,
    },
  },
};
