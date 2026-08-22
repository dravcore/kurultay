# 0018. Localization Strategy: next-intl Without URL Routing

**Status:** Accepted
**Date:** 2026-08-12
**Updated:** 2026-08-21: both key counts below are snapshots from different moments and have
since moved together: `en.json` and `tr.json` each carry 514 leaf keys today, still equal to each
other as the catalogue-parity gate requires.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0018-localization-strategy.md)

## Context

The product plan is to finish the English interface completely, then add Turkish as a second
language. That raised the question of whether next-intl is the right vehicle for Turkish or
whether a different approach is needed.

The answer to the narrow question is that next-intl is already the vehicle, and has been for
some time. `NextIntlClientProvider` wraps the root layout, `getLocale()` / `getMessages()`
feed it, 53 files call `useTranslations` or `getTranslations`, and `apps/web/messages/en.json`
holds roughly 279 keys. `formatRelativeTime` already takes a locale parameter rather than
pinning `'en'`. The only thing keeping the app monolingual is one line in
`apps/web/i18n/request.ts`:

```ts
const locale = 'en';
```

So the real decision is not "which library" but the three questions that line defers: how a
locale gets chosen, where the preference lives, and what happens to strings that are stored
in the database rather than in a message catalog.

Two constraints shape the answer. First, every page in Kurul is behind authentication —
there is no indexable content, and a marketing or documentation site, if one is built, will
live outside this Next.js application. Second, `apps/api` has no locale awareness at all:
errors are returned as stable codes plus an HTTP status, and the web maps them to translation
keys through `resolveApiMessage`.

This ADR is about product localization. The English-canonical / `docs/tr` mirror rule for
repository documentation is a separate, unrelated convention.

## Decision

next-intl stays; no second i18n library is introduced. Locale is resolved **without URL
routing**, from a chain implemented in `apps/web/i18n/request.ts`:

```
User.locale  →  locale cookie  →  Accept-Language  →  'en'
```

There is no `[locale]` path segment and no i18n middleware. Alongside that:

1. **Locale is a user-level preference**, stored as a nullable IETF tag on `User` and mirrored
   into a cookie when the user picks a language. It is not a workspace setting.
2. **The backend stays free of UI translation.** The API keeps returning error codes and
   statuses; the web owns the message catalog. The API reads `Accept-Language` only for
   content it writes into the database on the user's behalf, and for outbound email.
3. **Stored strings follow the renameability rule:** if a user can rename it, it is user data —
   seed it in the creator's locale and store it as a plain string. If a user cannot rename it
   (`priority`, roles, enum labels), it is system data — store the enum and translate on the
   web.
4. **English remains canonical.** `messages/en.json` is the source of truth; `tr.json` is added
   only once the English interface is complete.

## Rationale

- The one real payoff of a `[locale]` path segment is SEO: distinct URLs per language plus
  `hreflang`. Nothing in Kurul is indexed, so that payoff does not apply, and the marketing
  site that would need it is planned to live elsewhere.
- The costs of the path segment are paid immediately and in full: the entire `app/` tree moves
  under `app/[locale]/`, and every `<Link>` and `router.push` has to switch to next-intl's
  locale-aware wrappers — any call site that misses the switch silently resets the user's
  language, a quiet failure mode no test naturally catches.
- The middleware cost is worse than it first looks. `apps/web/middleware.ts` already exists and
  gates every route on a session, and all of its routing logic is **literal path matching**: a
  `PUBLIC_PATHS` set holding `/login`, `/register` and `/verify-email`, a
  `pathname.startsWith('/invite/')` check, and `pathname === '/'` for the root redirect. A
  locale prefix invalidates every one of those comparisons at once. Adopting routed i18n
  therefore means composing next-intl's middleware with the auth gate _and_ rewriting the auth
  gate's matching in the same change — on the one file where a mistake logs users out or, worse,
  lets an unauthenticated request through.
- next-intl documents the no-routing setup as a first-class configuration, so this choice does
  not fight the library or fall off the supported path.
- User-level rather than workspace-level, because one workspace legitimately contains members
  who read different languages. A workspace-wide setting would force one of them into the
  wrong interface.
- Keeping translation out of the backend avoids maintaining the same catalog twice. The API
  already speaks in codes; giving it prose in two languages would make the web's catalog and
  the API's catalog drift.

## Consequences

- `User` gains a nullable `locale` column and a migration; a settings screen has to expose it.
  Because outbound email needs the recipient's language, the preference must live in the
  database and not only in a cookie.
- `apps/web/i18n/request.ts` grows the resolution chain and a cookie write on language change.
- Unauthenticated routes — notably `/invite/[invitationId]` — resolve from `Accept-Language`,
  so an invitee sees their own language without being signed in. This is the desired behavior
  and the main reason the invite flow does not force the path-segment approach.
- A shared board URL carries no language: the recipient sees it in _their_ language, not the
  sender's. Accepted deliberately; it is usually what people want.
- Reviewing two languages side by side requires separate browser profiles or a private window.
- **Deferred, not dismissed:** if a marketing or documentation site is ever moved _into_ this
  application, `[locale]` routing has to be introduced at that point, and the migration is the
  full cost described above. That trigger is recorded here so the deferral stays a decision
  rather than an oversight.
- From now on every new user-visible string goes through `messages/en.json`. A hardcoded string
  is a defect, not a shortcut, because it is invisible to the Turkish pass and will not show up
  as a missing key.
- The API gains a small amount of locale awareness — reading `Accept-Language` — which it did
  not have before. It is confined to database seeding and email.
- **The seed column names live in the API, not in `@kurul/shared-types`.** Settled during
  implementation, because §3 leaves it open. They are data the API writes on the user's behalf,
  and once the web stopped seeding — `POST …/columns/defaults` replaced its three-request loop —
  the API became their only writer. A shared copy would ship every language's seed vocabulary
  into a browser bundle that never renders it. What stays shared is `SUPPORTED_LOCALES`, which
  genuinely crosses the boundary: the web renders the picker from it, the API validates
  `PATCH /me` against it. The structural half of the seed list (position, `ColumnCategory`) is
  held apart from the names so a translation cannot move a column or change what it means.
- Adding a language is a change to `SUPPORTED_LOCALES` plus the three things that then fail on
  their own: the API's `Record<Locale, …>` of seed names and its `Record<Locale, …>` of mail
  copy both stop compiling, and `messages/<tag>.json` fails the catalogue parity test until it
  exists and matches English key for key. No data migration, and no `User.locale` backfill —
  the column stays nullable, and null keeps meaning "follow the browser".
- `GET /me` reads `User.locale` from the database rather than from the session. Better Auth
  caches the session user in a cookie for 60 seconds, and `/me` is what the web's chain
  consults, so a session-carried locale would leave the interface in the old language for up to
  60 seconds after the user changed it.
- **§4's condition is met: Turkish ships.** The English interface was complete, so
  `messages/tr.json` was written against it — 486 keys, the same key set, the same ICU
  arguments. Seed column names gained a `tr` row (`Yapılacak / Devam Ediyor / Bitti`) and both
  transactional emails are now written in the recipient's language. English stays canonical:
  `en.json` is still the file a new string is added to, and the one the Turkish catalogue is
  measured against.
- **Role names are translated in the interface (`Sahip / Yönetici / Üye / Misafir`) and left in
  English in `docs/tr/**` (`owner'ından`, `admin'e`) — a deliberate split, not drift.** The docs
  are talking about the `OWNER`/`ADMIN` enum values and the `@kurul/auth-access` role
  identifiers, which are never translated; the badge is a word a person reads.
- **"100% translated" is a gate, not a claim.** `apps/web/messages/catalog.test.ts` fails the
  build on a key `en.json` has and another catalogue does not, on a key another catalogue has
  and English does not, and on a message whose ICU arguments differ between the two. It reads
  `SUPPORTED_LOCALES` rather than a hardcoded `['tr']`, so a third language is gated the day it
  is declared. Nothing else could catch this: next-intl resolves a missing message to its raw
  key path at runtime, so a half-translated locale compiles, passes type-checking and shows the
  user `app.board.column.deleteAction`.
- **Outbound mail resolves a language with no request in flight, and the chain has one more
  link than the interface's.** Settled during implementation, because §2 says only "and for
  outbound email". It is `recipient's User.locale → sender's User.locale → Accept-Language of
the triggering request → 'en'` (`apps/api/src/mail/recipient-locale.ts`). The middle link is
  the decision: an invitation may be addressed to someone who has no account on this instance
  at all, so there is no preference of theirs to read. Rather than defaulting those people to
  English, the invitation is written in the language of the person who sent it — the only human
  in the exchange whose language is known, who chose to write to that address, and whose
  language the invitation already discloses by naming them. For a verification email, actor and
  recipient are the same brand-new account, so the chain collapses to the browser they signed
  up in. A failed lookup degrades to the next link and is logged; it never fails the signup or
  the invitation that triggered it.
- **The mail copy is a `Record<Locale, …>` in the API, for the same reason the seed names are.**
  It is not interface text — nothing re-renders it in a viewer's language — and a language
  added to `SUPPORTED_LOCALES` fails to compile until its email copy exists, so a locale cannot
  ship with a translated interface and English email. Word order is what makes it a table of
  functions rather than of format strings: Turkish puts the workspace name before the verb and
  the verb last, and a shared `{inviter} invited you to {workspace}` template would force one
  language into the other's grammar.

## Alternatives considered

| Alternative                                           | Why not                                                                                                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[locale]` path segment (next-intl's routed default)  | Its SEO payoff does not apply to an app with no indexable pages; it costs the whole route tree, a rewrite of the existing auth middleware's literal path matching, and permanent link discipline starting today |
| Workspace-level locale                                | One workspace legitimately has members who read different languages; a shared setting forces someone into the wrong language                                                                                    |
| Backend i18n (`nestjs-i18n`, `Accept-Language` prose) | Duplicates the catalog the web already owns and lets the two drift; the API already returns codes, which the web maps through `resolveApiMessage`                                                               |
| Switch to react-i18next or Lingui                     | next-intl is already integrated across 53 files and is the App-Router-native choice; a swap buys nothing and re-does working code                                                                               |
| Machine translation at request time                   | Unpredictable product vocabulary, per-request latency and cost, and no way to review the wording before users see it                                                                                            |
