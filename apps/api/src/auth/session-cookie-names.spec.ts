import { sessionCookieNames } from './session-cookie-names';

describe('sessionCookieNames', () => {
  it('covers both cookies, in both the plain and the __Secure- form', () => {
    const names = sessionCookieNames();

    // Length first: every assertion below this line is an `expect(...).toContain(...)`, and a
    // list that had quietly lost an entry would still satisfy the ones that remained.
    expect(names).toHaveLength(4);
    expect(names).toEqual(
      expect.arrayContaining([
        'better-auth.session_token',
        '__Secure-better-auth.session_token',
        'better-auth.session_data',
        '__Secure-better-auth.session_data',
      ]),
    );
  });

  it('includes the session_data cache, not only the token', () => {
    // The one that actually matters for account deletion: `session_data` is what
    // `auth.api.getSession` answers from for 60 seconds without a database read, so a list
    // that only expired the token would leave a deleted account signed in.
    expect(sessionCookieNames().filter((name) => name.includes('session_data'))).toHaveLength(2);
  });
});
