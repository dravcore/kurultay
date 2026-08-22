import { MemberRole } from '@kurul/shared-types';
import { organizationRoles } from '@kurul/auth-access';

/**
 * Guards the test runner's view of the workspace packages.
 *
 * `@kurul/shared-types` and `@kurul/auth-access` resolve through their `package.json` to a
 * git-ignored `dist/`. `jest.config.cjs` maps both specifiers to `src/index.ts` instead, so
 * the suite runs on a fresh checkout and never against a build that predates the source it
 * is testing. Nothing else in the suite would notice the mapping going away: with a `dist`
 * present, every other spec keeps passing, just against last week's enums.
 *
 * The value imports above are part of the assertion. They only load if the `.js` suffix the
 * packages' NodeNext sources put on relative imports is being resolved to `.ts`.
 */
describe('workspace packages under Jest', () => {
  it('resolves @kurul/shared-types to the package source, not dist', () => {
    expect(require.resolve('@kurul/shared-types')).toMatch(
      /[\\/]packages[\\/]shared-types[\\/]src[\\/]index\.ts$/,
    );
    expect(MemberRole.OWNER).toBe('OWNER');
  });

  it('resolves @kurul/auth-access to the package source, not dist', () => {
    expect(require.resolve('@kurul/auth-access')).toMatch(
      /[\\/]packages[\\/]auth-access[\\/]src[\\/]index\.ts$/,
    );
    expect(Object.keys(organizationRoles)).toEqual(Object.keys(MemberRole));
  });
});
