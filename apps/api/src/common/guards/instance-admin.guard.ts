import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { envString } from '../env';
import type { AuthedRequest } from '../types/request-context';

/**
 * The one authorisation boundary in this codebase that is not a workspace role.
 *
 * Kurul has no super-user. Every permission is `WorkspaceMember.role`, scoped to a tenant,
 * and that was a deliberate shape: nobody can read across workspaces, including the person who
 * runs the server. The activation funnel is the first thing that legitimately has to — its
 * numbers are about the *instance* ("how many people registered", "how many teams were active
 * this week"), and there is no tenant those questions belong to.
 *
 * Three candidates were rejected before this one:
 *
 * 1. **Any workspace `OWNER`.** Registration is open on a default install and creating a
 *    workspace makes you its owner, so "owner of some workspace" is a role every visitor can
 *    grant themselves. It is not a boundary at all.
 * 2. **A `User.isAdmin` column.** It would need a UI to set, an escalation path to audit, and a
 *    first-admin bootstrap problem — a permanent new attack surface bought for one read-only
 *    screen.
 * 3. **No boundary: publish the funnel to every signed-in user.** This is the failure PR #188
 *    was corrected for, in the other direction: an `invitation.*` payload carried the invited
 *    e-mail address into a feed every GUEST could read, widening who could see something the
 *    invitations endpoint deliberately restricted to admins. `docs/architecture.md` now states
 *    the rule — a payload must never widen who can read a thing — and instance-wide activity
 *    counts are exactly a thing no workspace member was ever entitled to.
 *
 * So the boundary is the deployment's own configuration: an operator who can already read
 * `DATABASE_URL` names the accounts allowed to see instance-wide numbers. **Unset is the
 * default and means nobody** — a fresh install exposes this to no one, including its own
 * owner, until somebody writes an address into `.env` on purpose.
 *
 * `403`, not the `404` `WorkspaceGuard` answers. That 404 exists to stop a cross-tenant probe
 * distinguishing "forbidden" from "does not exist"; here there is nothing to hide — the route
 * is in the source of an AGPL project and its existence is not a secret. A 403 tells an
 * operator who forgot the variable what is actually wrong.
 */
export const INSTANCE_ADMIN_EMAILS_ENV = 'INSTANCE_ADMIN_EMAILS';

/**
 * Read per request rather than once at boot, matching `retentionSettings()`.
 *
 * A restart is the only way to change this either way, so caching would buy a `String.split`
 * per request on a route nothing polls — and reading live is what lets a test flip the
 * variable around a single call instead of rebuilding the Nest container.
 */
export function instanceAdminEmails(): ReadonlySet<string> {
  return new Set(
    envString(INSTANCE_ADMIN_EMAILS_ENV, '')
      .split(',')
      // Lower-cased on both sides of the comparison. Better Auth stores the address as the
      // user typed it at sign-up, and an operator writing `Admin@example.com` into `.env`
      // meaning the account that registered as `admin@example.com` would otherwise get a 403
      // with nothing in any log to explain it. Only the domain is truly case-insensitive per
      // RFC 5321, but no mail provider in practice treats the local part as case-sensitive,
      // and the failure mode of being strict here is worse than the failure mode of being
      // lenient.
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/** Whether this address is listed in `INSTANCE_ADMIN_EMAILS`. Empty list ⇒ always false. */
export function isInstanceAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return instanceAdminEmails().has(email.trim().toLowerCase());
}

@Injectable()
export class InstanceAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Runs after the global `SessionAuthGuard`, so `request.user` is populated for anything
    // this guard is allowed to protect. The check is not defensive typing: a handler that
    // reached here without a session would be one someone had marked `@Public()`, and
    // answering 403 rather than reading `undefined` keeps that mistake closed.
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;

    // `emailVerified` is required, not merely preferred: `requireEmailVerification: false`
    // means a session exists before mailbox ownership is proven, and a deleted account's
    // address is freed for a fresh sign-up (see `anonymised-user.ts`). Without this check,
    // registering a listed-but-unregistered or freed admin address — during the setup window
    // or after an admin account is deleted — would grant instance administration to whoever
    // types it into the sign-up form, without ever receiving mail at it.
    if (!isInstanceAdmin(user?.email) || !user?.emailVerified) {
      throw new ForbiddenException('Instance administration is restricted');
    }

    return true;
  }
}
