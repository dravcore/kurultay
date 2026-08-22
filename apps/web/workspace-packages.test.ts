import { describe, expect, it } from 'vitest';
import { MemberRole, SUPPORTED_LOCALES } from '@kurul/shared-types';
import { organizationRoles } from '@kurul/auth-access';
import * as sharedTypesSource from '../../packages/shared-types/src/index';
import * as authAccessSource from '../../packages/auth-access/src/index';

/**
 * Guards the test runner's view of the workspace packages.
 *
 * `@kurul/shared-types` and `@kurul/auth-access` resolve through their `package.json` to a
 * git-ignored `dist/`. `vitest.config.ts` aliases both specifiers to `src/index.ts`, so the
 * suite runs on a fresh checkout and never against a build that predates the source it is
 * testing. Nothing else in the suite would notice the alias going away: with a `dist` present,
 * every other test keeps passing, just against last week's enums.
 *
 * Vitest offers no supported way to ask where a specifier resolved to (`import.meta.resolve`
 * answers from Node's resolver and ignores the alias), so the check is by identity instead:
 * a module loaded twice by the same path is the same instance, and its exported objects are
 * the same references. A `dist` build would be structurally equal and fail `toBe`.
 */
describe('workspace packages under Vitest', () => {
  it('resolves @kurul/shared-types to the package source, not dist', () => {
    expect(MemberRole).toBe(sharedTypesSource.MemberRole);
    expect(SUPPORTED_LOCALES).toBe(sharedTypesSource.SUPPORTED_LOCALES);
  });

  it('resolves @kurul/auth-access to the package source, not dist', () => {
    expect(organizationRoles).toBe(authAccessSource.organizationRoles);
  });
});
