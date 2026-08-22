/**
 * Escapes the SQL `LIKE`/`ILIKE` metacharacters — `%`, `_`, and the backslash used to escape
 * them — so a string can be handed to a Prisma `contains` (or `startsWith`/`endsWith`) filter
 * and matched *literally*.
 *
 * Prisma does not do this itself. Empirically (Prisma 7.9.1 + `@prisma/adapter-pg` against
 * PostgreSQL 18): `{ contains: q, mode: 'insensitive' }` compiles to
 * `title ILIKE ('%' || $1 || '%')`, and plain `{ contains: q }` (no `mode`) compiles to the
 * same shape with `LIKE` — in both cases `q` is bound as a *pattern*, not a literal, so any
 * `%`/`_` inside the caller's string keeps its SQL wildcard meaning. Seeding rows `"50% done"`
 * and `"50X done"` and searching `q = "50%"` matched both; searching `q = "a_b"` against
 * `"a_b"` and `"aXb"` matched both. A search box user who types a literal `%` or `_` — or an
 * account-deletion sweep matching on a stored value that happens to contain one, e.g. an email
 * local-part's legal `_` — silently gets extra rows instead of the exact ones they meant.
 *
 * Backslash is escaped first: escaping `%`/`_` afterwards would double-escape the backslashes
 * that first step just introduced, corrupting the round-trip.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
