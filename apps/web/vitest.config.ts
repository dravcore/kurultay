import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(rootDir, '../../packages');

export default defineConfig({
  resolve: {
    alias: {
      '@': rootDir,
      // The workspace packages resolve through `package.json` `exports` to a git-ignored
      // `dist/`, so without these two entries the suite needs a build first and, worse, keeps
      // passing against a stale one. Pointing them at `src/index.ts` makes Vitest compile the
      // same source `pnpm typecheck` reads. The sources' `.js`-suffixed relative imports
      // (`export * from './enums.js'`) need nothing extra: Vite already resolves them to the
      // `.ts` file. `workspace-packages.test.ts` asserts the alias holds.
      '@kurul/shared-types': path.join(packagesDir, 'shared-types/src/index.ts'),
      '@kurul/auth-access': path.join(packagesDir, 'auth-access/src/index.ts'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: ['node_modules/**', '.next/**', '**/*.test.{ts,tsx}', '**/*.config.*'],
      // No *global* `thresholds` gate here, still on purpose — but not for the reason this
      // comment used to give. Overall coverage is no longer ~13%; it is around 46%, and the
      // `app/**` floor below is the glob threshold the old note said it was waiting for.
      // What keeps a global floor off is that the number is still an average over two very
      // different populations: units with real tests sit well above it, and page-level
      // components with none sit near zero. A floor at the average would ratchet on the
      // second group's absence rather than on any regression in the first.
      //
      // Route-level tests now exist, so `app/**` is exactly the "meaningfully-tested
      // folder" that comment was waiting for — and it is the one place a glob floor is not
      // brittle: routes are thin (await params, translate a title, compose components) and
      // a new page arriving with no test at all is the regression worth catching. The
      // global gate stays absent for the reason above; only this folder is floored.
      //
      // Floors sit a few points under the measured baseline, the same margin
      // `apps/api/jest.config.cjs` uses, so routine refactors do not trip them.
      //
      // `app/**` (2026-08-12): stmts 90.93 / branch 100 / funcs 90 / lines 90.93.
      // `app/layout.tsx` counts here too: `next/font/google` is stubbed in its test rather
      // than the file being excluded, because an excluded file is an invisible one.
      //
      // Board / task / layout (2026-08-12, same `test:cov` run): board 70/59/59/75,
      // task 65/65/63/67, layout 80/71/90/84. These are the interactive surfaces that
      // already have meaningful unit coverage; a second glob floor catches deleting a
      // board/task/layout test without waiting for a global average to become meaningful.
      //
      // `components/notification/**` and `lib/**` (2026-08-15, QA-04): the bell's badge, the
      // dropdown's click-through and the page that lists the same rows were the last
      // interactive surface with no floor watching it, and `lib/notification-actions.ts` and
      // `lib/notification-nav.ts` — the two modules that decide where a clicked notification
      // takes you — were at 0% on every metric. Measured after the behaviour tests landed:
      // notification 96.35/88.79/100/98.83, lib 96.08/88.49/98.23/96.98.
      //
      // `lib/**` is floored as a folder rather than as those two files because it is already
      // the best-covered folder in the app (91.55% statements before this change): a floor
      // there is a ratchet on code that is genuinely tested, which is the only kind this file
      // sets. It also means a new helper landing in `lib/` with no test at all is visible,
      // which is the regression the notification helpers themselves were.
      thresholds: {
        'app/**': {
          statements: 85,
          branches: 90,
          functions: 85,
          lines: 85,
        },
        'components/board/**': {
          statements: 65,
          branches: 54,
          functions: 54,
          lines: 70,
        },
        'components/task/**': {
          statements: 60,
          branches: 60,
          functions: 58,
          lines: 62,
        },
        'components/layout/**': {
          statements: 75,
          branches: 65,
          functions: 85,
          lines: 78,
        },
        'components/notification/**': {
          statements: 91,
          branches: 83,
          functions: 95,
          lines: 93,
        },
        'lib/**': {
          statements: 91,
          branches: 83,
          functions: 93,
          lines: 92,
        },
      },
    },
  },
});
