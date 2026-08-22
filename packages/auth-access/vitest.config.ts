import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // `test/permissions.test.ts` compares role keys against `MemberRole`, which it imports
      // from `@kurul/shared-types`. That specifier resolves to the sibling package's
      // git-ignored `dist/`, so without this entry the suite needs a build first and passes
      // against a stale one afterwards. Same arrangement as `apps/web/vitest.config.ts`.
      '@kurul/shared-types': path.resolve(rootDir, '../shared-types/src/index.ts'),
    },
  },
  test: {
    // No DOM here — this package is Better Auth role definitions and nothing else.
    environment: 'node',
    // Tests live in `test/` rather than beside the sources: `tsconfig.json` builds `src/**`
    // into `dist`, so a colocated `*.test.ts` would be compiled and published with the
    // package. Same arrangement as `packages/shared-types`.
    include: ['test/**/*.test.ts'],
  },
});
