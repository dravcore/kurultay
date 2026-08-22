/**
 * The cookies Better Auth uses to carry a session, under every name it can give them.
 *
 * There are two cookies, not one, and the second is the reason this file exists.
 * `better-auth.session_token` is the credential; `better-auth.session_data` is the 60-second
 * signed cache that `auth.api.getSession` answers from **without consulting the database**
 * (`session.cookieCache` in `auth.ts`). Deleting a user's `Session` rows therefore does not stop
 * their browser presenting a valid session until that cache expires — clearing both cookies is
 * what actually ends it, which is why account deletion clears them on the way out.
 *
 * Each has two names. Better Auth prefixes the cookie with `__Secure-` when it decides the
 * deployment is secure (`isProduction` unless `advanced.useSecureCookies` says otherwise), and
 * the *browser* treats `__Secure-better-auth.session_token` and `better-auth.session_token` as
 * two different cookies. Clearing only the name this process would have written leaves the other
 * one in place on any deployment whose `NODE_ENV` differs from the one that set it — so both are
 * cleared, always. Clearing a cookie the browser does not hold costs one `Set-Cookie` header.
 *
 * `cookiePrefix` is left at Better Auth's default in `auth.ts`; if that ever changes, this list
 * has to change with it, which is why it is a named constant rather than four string literals
 * inside a controller.
 */
const SECURE_COOKIE_PREFIX = '__Secure-';

const SESSION_COOKIE_BASE_NAMES = [
  'better-auth.session_token',
  'better-auth.session_data',
] as const;

/** Every cookie name that has to be expired to end a session in the browser. */
export function sessionCookieNames(): string[] {
  return SESSION_COOKIE_BASE_NAMES.flatMap((name) => [name, `${SECURE_COOKIE_PREFIX}${name}`]);
}
