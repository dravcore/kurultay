import { envString } from '../common/env';

const DEFAULT_WEB_URL = 'http://localhost:3000';

/**
 * Web route the invitation link points at.
 * Owned by `apps/web/app/(auth)/invite/[invitationId]/page.tsx`.
 */
const INVITE_PATH = '/invite';

/**
 * Web route of one card, read under its board.
 * Owned by `apps/web/app/(app)/board/[boardId]/task/[taskId]/page.tsx`.
 */
const BOARD_PATH = '/board';

/**
 * Web route a verification link lands on when the caller did not name one.
 * Owned by `apps/web` — see the contract in
 * `docs/decisions/0013-invitation-email-verification.md`.
 */
export const DEFAULT_VERIFICATION_CALLBACK_PATH = '/verify-email';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Base URL of the web app.
 *
 * Read at call time, not at module load: this module is imported by `auth/auth.ts`, whose
 * `loadRootEnv()` runs *after* its imports have been evaluated, so a module-level read here
 * would see the environment before `.env` was applied.
 */
export function webAppUrl(): string {
  return trimTrailingSlash(envString('WEB_URL', DEFAULT_WEB_URL));
}

/**
 * The page an invitee opens to accept an invitation.
 *
 * The single definition of that route on the API side: the invitation email and the
 * `acceptUrl` returned by `POST /workspaces/:id/invitations` must never drift apart.
 */
export function buildInviteAcceptUrl(invitationId: string): string {
  return `${webAppUrl()}${INVITE_PATH}/${invitationId}`;
}

/**
 * Points a Better Auth verification link at the web app.
 *
 * Better Auth builds `…/auth/verify-email?token=…&callbackURL=…`, where `callbackURL` is
 * whatever the client passed to sign-up / send-verification-email and defaults to `"/"`.
 * That default is relative to the **API** origin, so an untouched link would verify the
 * address and then drop the user on the API's root. Web and API are separate origins here,
 * so the callback is rewritten to an absolute web URL:
 *
 * - missing or `"/"` — no preference expressed, use the web app's verification page;
 * - a path (`/dashboard`) — a page on the web app, resolved against `WEB_URL`;
 * - an absolute URL — left alone. Better Auth's own `originCheck` already refuses any origin
 *   outside `trustedOrigins`, and second-guessing it here would break a deliberate choice.
 */
export function resolveVerificationUrl(verificationUrl: string): string {
  let url: URL;
  try {
    url = new URL(verificationUrl);
  } catch {
    // Not a URL we can reason about; hand it back untouched rather than drop the email.
    return verificationUrl;
  }

  const callback = url.searchParams.get('callbackURL');
  if (callback !== null && callback !== '' && callback !== '/' && !callback.startsWith('/')) {
    return verificationUrl;
  }

  const path =
    callback === null || callback === '' || callback === '/'
      ? DEFAULT_VERIFICATION_CALLBACK_PATH
      : callback;
  url.searchParams.set('callbackURL', `${webAppUrl()}${path}`);
  return url.toString();
}

/**
 * The page a notification email links to: the card, opened on its board.
 *
 * Defined here next to the invitation link for the same reason: the route is the web's, and
 * the API side should spell it in exactly one place.
 */
export function buildTaskUrl(boardId: string, taskId: string): string {
  return `${webAppUrl()}${BOARD_PATH}/${boardId}/task/${taskId}`;
}
