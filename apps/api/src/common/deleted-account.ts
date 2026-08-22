import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Refuses a request whose session belongs to an account that has already been deleted.
 *
 * ## Why this is needed at all
 *
 * Deleting an account deletes its `Session` rows, and that is not enough on its own. Better
 * Auth's `session.cookieCache` answers `auth.api.getSession` from a signed cookie for 60
 * seconds **without consulting the database** (`auth.ts`, and
 * `better-auth/dist/api/routes/session.mjs` for the branch that returns early), so a cookie
 * issued before the deletion keeps authenticating until it expires. `DELETE /me` clears those
 * cookies on the way out, which closes it for the browser that asked; an instance administrator
 * deleting somebody else's account cannot reach their browser.
 *
 * ## Why it is called at two entry points and not in `SessionAuthGuard`
 *
 * Putting it in the guard would close the window completely and would add a database round trip
 * to **every authenticated request in the product** to do it — for a 60-second window after a
 * rare administrative action. During that window the account has no membership anywhere, so
 * every workspace-scoped route already answers `404` through `WorkspaceGuard` off a read it was
 * making anyway. What is left is the handful of routes that are not workspace-scoped, and only
 * two of them write: creating a workspace (which would give a tombstone a membership again) and
 * patching the profile (which would un-null part of the anonymisation). Those two call this.
 * See `docs/decisions/0026-account-deletion-anonymisation.md`.
 *
 * `401`, not `403`: the session is over, and `401` is what tells the web client to send the
 * user back through sign-in rather than to show them a permissions error about their own
 * account.
 */
export async function assertAccountNotDeleted(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true },
  });

  // A missing row is the same answer as a deleted one. It is not reachable today — the row is
  // never deleted — but "the session names a user that is not there" is not a state any handler
  // below should be reasoning about.
  if (!user || user.deletedAt !== null) {
    throw new UnauthorizedException('This account has been deleted');
  }
}
