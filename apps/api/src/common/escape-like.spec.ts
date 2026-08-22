import { escapeLikePattern } from './escape-like';

describe('escapeLikePattern', () => {
  it('escapes a bare percent so it stops meaning "any run of characters"', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
  });

  it('escapes a bare underscore so it stops meaning "any one character"', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslash first, so a literal backslash does not become an escape for what follows', () => {
    // If `%`/`_` were escaped before the backslash, `\%` would wrongly read as "already escaped"
    // and lose its own backslash-escaping — this fixture would come back as `\%` instead of `\\%`.
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('leaves an ordinary string untouched', () => {
    expect(escapeLikePattern('login')).toBe('login');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeLikePattern('%_%_')).toBe('\\%\\_\\%\\_');
  });
});
