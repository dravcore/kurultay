import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  INSTANCE_ADMIN_EMAILS_ENV,
  InstanceAdminGuard,
  instanceAdminEmails,
  isInstanceAdmin,
} from './instance-admin.guard';
import type { AuthedRequest } from '../types/request-context';

function mockContext(email: string | undefined, emailVerified = true): ExecutionContext {
  const request: Partial<AuthedRequest> = email
    ? {
        user: {
          id: 'u1',
          email,
          name: 'A',
          avatarUrl: null,
          emailVerified,
          createdAt: new Date(),
        },
      }
    : {};

  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('InstanceAdminGuard', () => {
  const original = process.env[INSTANCE_ADMIN_EMAILS_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[INSTANCE_ADMIN_EMAILS_ENV];
    else process.env[INSTANCE_ADMIN_EMAILS_ENV] = original;
  });

  /**
   * The default, and the reason this guard exists at all.
   *
   * A fresh install has no `INSTANCE_ADMIN_EMAILS`, and on a fresh install *every* signed-in
   * account must be refused — including the first one, which on a self-hosted box is almost
   * certainly the operator's own. Instance-wide numbers become readable only when somebody
   * writes an address into `.env` on purpose. Delete the `.filter()` in `instanceAdminEmails`
   * and `''.split(',')` yields `['']`, which is what this asserts cannot match.
   */
  it('refuses everybody when INSTANCE_ADMIN_EMAILS is unset', () => {
    delete process.env[INSTANCE_ADMIN_EMAILS_ENV];
    const guard = new InstanceAdminGuard();

    expect(instanceAdminEmails().size).toBe(0);
    expect(() => guard.canActivate(mockContext('owner@example.com'))).toThrow(ForbiddenException);
  });

  it('refuses everybody when the variable is present but blank', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = '   ';
    const guard = new InstanceAdminGuard();

    expect(() => guard.canActivate(mockContext('owner@example.com'))).toThrow(ForbiddenException);
  });

  it('admits a listed address', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'ops@example.com';
    const guard = new InstanceAdminGuard();

    expect(guard.canActivate(mockContext('ops@example.com'))).toBe(true);
  });

  it('refuses an address that is not listed, however plausible', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'ops@example.com';
    const guard = new InstanceAdminGuard();

    expect(() => guard.canActivate(mockContext('ops@example.org'))).toThrow(ForbiddenException);
  });

  /** Several operators, written the way a human writes a list. */
  it('reads a comma-separated list and tolerates the spaces around it', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = ' ops@example.com , second@example.com ,,';

    expect(isInstanceAdmin('ops@example.com')).toBe(true);
    expect(isInstanceAdmin('second@example.com')).toBe(true);
    expect(instanceAdminEmails().size).toBe(2);
  });

  /**
   * Better Auth stores the address as typed at sign-up; an operator writing `Ops@Example.com`
   * into `.env` means the same account. A 403 with nothing in any log to explain it is the
   * worst possible outcome of a case mismatch.
   */
  it('matches regardless of case on either side', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'Ops@Example.COM';

    expect(isInstanceAdmin('ops@example.com')).toBe(true);
    expect(isInstanceAdmin('OPS@EXAMPLE.COM')).toBe(true);
  });

  /**
   * The `@Public()` mistake: a handler that reached this guard without a session must be
   * refused rather than read `undefined.email`.
   */
  it('refuses a request with no session on it', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'ops@example.com';
    const guard = new InstanceAdminGuard();

    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
    expect(isInstanceAdmin(undefined)).toBe(false);
  });

  /**
   * `requireEmailVerification: false` (see `auth.ts`) means a session can exist before mailbox
   * ownership is proven, and a deleted account's address is freed for a fresh sign-up (see
   * `anonymised-user.ts`). Being listed in `INSTANCE_ADMIN_EMAILS` must not be enough on its
   * own: registering a listed-but-unregistered or freed admin address must not grant instance
   * administration to someone who has never received mail at it.
   */
  it('refuses a listed address whose email is not yet verified', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'ops@example.com';
    const guard = new InstanceAdminGuard();

    expect(() => guard.canActivate(mockContext('ops@example.com', false))).toThrow(
      ForbiddenException,
    );
  });

  /** The positive case for the check above: verified and listed still passes. */
  it('admits a listed address whose email is verified', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'ops@example.com';
    const guard = new InstanceAdminGuard();

    expect(guard.canActivate(mockContext('ops@example.com', true))).toBe(true);
  });

  /** Read per request, so a restart — or a spec — changes the answer with no rebuild. */
  it('re-reads the environment on every call', () => {
    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'first@example.com';
    expect(isInstanceAdmin('first@example.com')).toBe(true);

    process.env[INSTANCE_ADMIN_EMAILS_ENV] = 'second@example.com';
    expect(isInstanceAdmin('first@example.com')).toBe(false);
    expect(isInstanceAdmin('second@example.com')).toBe(true);
  });
});
