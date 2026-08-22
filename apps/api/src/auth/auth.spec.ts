import { auth } from './auth';

describe('auth options', () => {
  it('pins session.cookieCache.maxAge to 60 seconds (SEC-01)', () => {
    // This is the entire revocation window for password changes, admin force-delete, and a
    // stolen `session_data` cookie: Better Auth answers `getSession` from the signed cookie
    // without a database read until this expires (see the comment on
    // `SESSION_COOKIE_CACHE_MAX_AGE_SECONDS` in `auth.ts`). Pinned rather than left to float —
    // widening it silently reopens a window every doc in the repo describes as ~60s.
    expect(auth.options.session?.cookieCache?.maxAge).toBe(60);
  });

  it('leaves session.cookieCache enabled', () => {
    // The cache still exists — the fix narrows the window, it does not remove the DB-read
    // savings that motivated it.
    expect(auth.options.session?.cookieCache?.enabled).toBe(true);
  });
});
