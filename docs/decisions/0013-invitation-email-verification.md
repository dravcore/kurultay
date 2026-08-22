# 0013. Invitation-Acceptance Email Verification

**Status:** Accepted
**Date:** 2026-08-10

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0013-invitation-email-verification.md)

## Context

Better Auth's organization plugin carries an advisory, GHSA-fmh4-wcc4-5jm3: unauthorized
invitation acceptance via an unverified email match. An invitation targets an email address,
not an account; if the plugin accepts it from _any_ account whose email matches that address,
an attacker who registers first — using the invited address, before its real owner ever signs
up — holds the invitation and joins the workspace in their place. Better Auth 1.6 hardened the
plugin's _default_ rather than removing the check outright: `accept-invitation` and
`get-invitation` now demand a verified email whenever the invitation id was not produced by
the plugin's own opaque id generator. Kurul's `advanced.database.generateId` uses
`uuidv7()` for every table, invitations included, so it does not count as "built-in" and the
hardened default would apply to us automatically — except `apps/api/src/auth/auth.ts` sets
`requireEmailVerificationOnInvitation: false` explicitly, which wins over the default and
keeps the gap open.

That override was not an oversight. At the time it was written, `sendInvitationEmail` was a
no-op (email delivery was deferred beyond MVP — see [ROADMAP.md](../../ROADMAP.md)) and
`emailAndPassword.requireEmailVerification` was already `false`, so no user could ever reach a
verified state; turning the invitation check on as-is would have made every invitation
permanently unacceptable instead of merely insecure. Upgrading the better-auth dependency
alone cannot close GHSA-fmh4-wcc4-5jm3 here — email delivery has to exist first, or the fix
just trades one broken state for another.

## Decision

Ship SMTP-based email delivery (`apps/api/src/mail/`, `nodemailer`, configured only through
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` / `MAIL_FROM`
environment variables — no provider-specific API, so a self-hosted deployment is never
coupled to a vendor) and use it for exactly one purpose at launch: the verification email that
`requireEmailVerificationOnInvitation: true` needs. Normal sign-up and sign-in are unaffected —
`emailAndPassword.requireEmailVerification` stays `false`. Only the invitation-acceptance path
now requires a verified email address.

## Rationale

- The vulnerability lives specifically in _invitation_ acceptance — an attacker racing the
  real invitee to register first. Sign-up and sign-in have no equivalent race: an account owns
  its own email from creation, nothing else is contending to claim it. Fixing only the exposed
  path avoids an unrelated, higher-friction change (forcing verification on every
  registration) that the threat model does not call for.
- SMTP + environment variables, not a provider SDK (Resend, SendGrid, Postmark, …), because
  Kurul is AGPL and self-hostable: a provider API key is one more account a self-hoster
  would have to create and pay for just to run the software. Any mail server they already
  operate speaks SMTP.
- A no-op fallback when `SMTP_HOST` is unset preserves the existing boot behavior for anyone
  not yet ready to configure mail — the app does not hard-fail the way it does for a missing
  `BETTER_AUTH_SECRET` — but that convenience has a sharp edge, called out explicitly below
  rather than left to be discovered in production.

## Consequences

- Existing users are unaffected: no account is retroactively required to verify, and normal
  login never checks `emailVerified`.
- **A deployment that never configures SMTP can no longer have its invitations accepted.**
  This trades a security hole for a hard operational requirement, not a silent regression:
  `.env.example` documents the `SMTP_*` variables and states the consequence of leaving them
  unset; `docker-compose.yml` passes them through to the `api` service with no default host,
  so production has to opt in deliberately; `docker-compose.dev.yml` ships a Mailpit container
  so local development is never itself blocked (see
  [development.md](../development.md#smtp-and-mailpit)).
- Closing GHSA-fmh4-wcc4-5jm3 means `requireEmailVerificationOnInvitation: false` in
  `apps/api/src/auth/auth.ts` is dropped once the mail module ships — the flag exists today
  only because turning it on without email delivery would have broken every invitation, and
  that precondition is what this ADR removes.
- `apps/api/src/mail/` becomes a small runtime dependency of the invitation flow; a broken
  SMTP configuration degrades to "invitations fail" rather than "the API is down" — invite
  send and invite accept are the only code paths that touch it at launch.
- Future notification email (mentions, due-soon reminders — see
  [ROADMAP.md — Beyond MVP](../../ROADMAP.md#beyond-mvp)) can reuse the same module and the same
  environment variables instead of introducing a second mail path later.

## Alternatives considered

| Alternative                                                                           | Why not                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider-specific email API (Resend, SendGrid, Postmark)                              | Faster to integrate, but couples a self-hostable AGPL product to a paid external account — the opposite of the deployment model the rest of the stack targets                        |
| Require verified email everywhere (`emailAndPassword.requireEmailVerification: true`) | Closes more than the actual hole; adds sign-up friction for a race condition that only exists on the invitation path                                                                 |
| Upgrade better-auth and drop the `false` override, without shipping email             | Does not work standalone — `sendInvitationEmail` still has nothing to send, so no account could ever reach `emailVerified: true` and every invitation would become permanently stuck |
