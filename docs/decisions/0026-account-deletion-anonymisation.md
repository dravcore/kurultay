# 0026. Account Deletion: Anonymise the User Row, Decide the Owned Workspace in the Flow

**Status:** Accepted
**Date:** 2026-08-15
**Updated:** 2026-08-18 — the deletion also removes every `WorkspaceInvitation` addressed to the departing user, in any state: `email` is a literal column anonymising the `User` row never touched, so the real address outlived the erasure request (audit finding DB-01).
**Updated:** 2026-08-18 — `session.cookieCache.maxAge` (`api/src/auth/auth.ts`) shrank from 5 minutes to 60 seconds, so the "five minutes" figures below describing the deleted-account cookie window are historical: the actual window this ADR accepts is now up to 60 seconds (audit finding SEC-01).

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0026-account-deletion-anonymisation.md)

## Context

[ADR 0020](0020-data-retention.md) closed with a sentence that named this decision and refused
to make it:

> This ADR does **not** address deletion on request (GDPR Article 17 / KVKK Article 7). A user
> asking for their account to be erased still has no path, because `Restrict` foreign keys make
> a bare `DELETE FROM "User"` impossible by design.

That is the whole of the problem, and it is worse than "there is no button". Audit finding
DB-05 measured it: `grep -rn 'deleteUser' apps/` returns nothing, `user.deleteUser` is not
enabled in the Better Auth configuration, and **seven** foreign keys reference `User` with
`onDelete: Restrict`:

| Relation                      | Since | What it anchors                    |
| ----------------------------- | ----- | ---------------------------------- |
| `WorkspaceMember.user`        | init  | Membership of a workspace          |
| `WorkspaceInvitation.inviter` | init  | Who offered someone access         |
| `Task.createdBy`              | init  | Who opened a card                  |
| `TaskAssignee.user`           | init  | Who is working on a card           |
| `Comment.user`                | init  | Who wrote a comment                |
| `Activity.user`               | init  | Who did the thing the feed records |
| `Attachment.uploadedBy`       | 0024  | Who uploaded a file                |

So a self-hoster with a European or Turkish user has no way to satisfy an erasure request:
there is no endpoint, and `DELETE FROM "User" WHERE id = …` in `psql` fails on the first of
those seven. That last part is the sharp edge — the operator cannot even do it by hand.

Three further constraints shaped the answer rather than merely bounding it:

1. **A `Comment` and an `Activity` row are not only the author's.** A departing member's
   comments are half of conversations other people are still having, and the activity feed is
   the workspace's record of who changed what. Deleting them rewrites a board's history for
   everyone still on it. Leaving them attached to a named person defeats the request.
2. **Better Auth owns the `user` table** ([ADR 0004](0004-auth-better-auth.md)). Whatever this
   does must be something the auth library's own model tolerates.
3. **A user may be the sole `OWNER` of a workspace other people are working in.** Nothing may
   silently cascade that away, and nothing may leave it ownerless.

## Decision

**The `User` row is anonymised in place; it is never deleted.** Everything that is only ever
about that person — credentials, sessions, verification tokens, notifications, usage pings,
open assignments, pending invitations they sent — is hard-deleted. Everything that is also
somebody else's — comments, tasks, activity, attachments — keeps pointing at the same row,
which no longer says who the person was.

The seven `Restrict` foreign keys are **unchanged**. None of them is relaxed, and the schema
change this ADR carries is one nullable column.

### 1. What the anonymised row looks like

| Column          | After                               |
| --------------- | ----------------------------------- |
| `id`            | unchanged — this is the point       |
| `email`         | `deleted-<id>@deleted.invalid`      |
| `name`          | `Deleted user`                      |
| `emailVerified` | `false`                             |
| `avatarUrl`     | `null`                              |
| `locale`        | `null`                              |
| `deletedAt`     | the moment the request was executed |

**The replacement address is derived from `User.id`, not from a hash of the old address.** The
audit's own recommendation said "email → irreversible hash", and that is the one place this
ADR departs from it, because a hash of an e-mail address is a _pseudonym_, not an anonym:
anyone holding a list of addresses can hash them and confirm which ones had accounts here. That
is precisely the linkage Article 4(5) calls pseudonymisation and Recital 26 declines to treat
as anonymous. `User.id` is a UUIDv7 that is already written into every content row this design
keeps, so it carries no information the rows do not already carry, and it cannot be inverted
into an address. `.invalid` is reserved by RFC 2606 and can never be routed or re-registered.

`deletedAt` is the only new column. It exists so that "is this a tombstone" is a state and not
a string comparison against the display name — a name any live user is free to type.

### 2. Authorship, mentions, and `Activity.payload`

- **`createdById`, `uploadedById`, `Comment.userId`, `Activity.userId`, `WorkspaceInvitation.inviterId`
  are left exactly as they are.** The id is what makes the content readable, the threading
  intact and the audit trail joinable; after the row is anonymised the id resolves to
  "Deleted user" and nothing else.
- **`TaskAssignee` rows for the user are deleted.** An assignment is not history — it is a live
  claim on unfinished work, and a card assigned to a deleted account is a card nobody owns while
  looking like a card somebody owns.
- **Mentions inside comment bodies are rewritten.** `Comment.body` stores mention markup as
  `@[Display Name](userId)`, so the person's name is _literal text in the comment_, and
  anonymising the `User` row does not touch a byte of it. Every body carrying that user's id is
  rewritten to `@[Deleted user](userId)` with the same pattern `parseMentions` uses, so the
  mention still resolves and still highlights — it just no longer names anyone.
- **`Activity.payload` is scrubbed at one field.** The payloads in this codebase carry ids and
  not names, deliberately and almost without exception: `assigneeUserId`, `actorId`,
  `invitationId`, `mentionedUserIds`, `commentId`. The exception is `targetName`, written by
  `member.removed`, `member.left` and `member.role_changed` so that the entry stays readable
  after the roster row is gone. Where `payload->>'targetUserId'` is the departing user, that one
  field is set to `Deleted user`. Nothing else in the payload is touched, because nothing else
  in it is a person's name.

### 3. A workspace the user solely owns — the flow asks

`GET /me/deletion-preview` answers the question **before** anything is destroyed: which
workspaces the caller is the only `OWNER` of, how many members and boards each has, and who
could be promoted in their place. `DELETE /me` then requires one explicit disposition per such
workspace:

| Disposition                              | Effect                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `{ action: 'transfer', newOwnerUserId }` | That member becomes `OWNER`; a `member.role_changed` row records it                       |
| `{ action: 'delete' }`                   | The workspace is deleted with everything in it; a `workspace.deleted` log line records it |

A missing, unknown or duplicated disposition is a **`409`** that names the workspaces still
undecided. There is no default, and there is deliberately no "guess": promoting the
longest-serving member would hand a stranger a tenant, and deleting silently would take other
people's boards with it.

**A workspace with no other member can only be deleted**, and the preview says so by returning
an empty candidate list rather than by leaving the client to work it out. There is nobody to
transfer to, and a workspace with no members is not a workspace anyone can reach.

Workspaces where the user is an `OWNER` alongside another `OWNER`, or holds any other role,
need no disposition: their membership is simply removed.

### 4. Who may trigger it, and when it happens

Both, and immediately.

- **The user themselves** — `DELETE /me`, confirmed by sending their own e-mail address in the
  body. That confirmation is an anti-misclick gate and is documented as nothing more: the
  session presenting the request can already delete every workspace the user owns, so a
  password re-prompt here and nowhere else would buy no security while implying it had.
- **An instance administrator** — `DELETE /instance/users/:userId`, behind `InstanceAdminGuard`
  and therefore behind `INSTANCE_ADMIN_EMAILS`. This is not a convenience: an erasure request
  usually arrives as an e-mail to the operator, often from someone who has already lost access
  to the account, and a self-service-only design makes those requests unfulfillable — the exact
  failure DB-05 describes.

**Immediate, with no grace period.** Article 17 says "without undue delay"; a grace period
would add a half-alive account state, a cancellation path, and an operator answer of "it will
be gone by tomorrow" to a metric stated in minutes. The nightly retention sweep
([ADR 0020](0020-data-retention.md)) was considered as the execution vehicle and rejected for
that reason — it is a scheduled _policy_ sweep with no request behind it, and this is a request
with a person waiting on it. The sweep and this path do not interact: an anonymised row is not
eligible for any window the sweep enforces, and the sessions and verification rows the sweep
would eventually have expired are deleted here outright.

### 5. Better Auth's `user.deleteUser` stays disabled

Better Auth 1.6 ships `/auth/delete-user`, off by default. Its `internalAdapter.deleteUser`
deletes the `account` rows and then the `user` row (`dist/db/internal-adapter.mjs`) — which is
the exact statement seven `Restrict` foreign keys exist to refuse, so enabling it would buy a
route that 500s on any account that has ever created a card. Its `beforeDelete` hook cannot
rescue that either: the hard delete still runs afterwards.

So the flow lives in Nest, and it does to the `user` row the one thing Better Auth is entirely
comfortable with — an `UPDATE`. Everything the library needs afterwards remains true: the row
exists, its `id` is stable, its `email` is unique, and with no `Account` row it can never
authenticate. The library's own model is not fought; it is simply not asked to delete anything.

**Membership rows are removed with Prisma, not through `auth.api.*`**, and that is an exception
to `WorkspaceMemberService`'s standing rule that the plugin owns those writes. The rule assumes
the caller is a member of the workspace, because `auth.api.removeMember` authorises against the
caller's own session — and on the administrator path the caller is not in the workspace at all.
The three things the plugin would have done are done explicitly instead: sockets are evicted per
workspace (`evictUserFromWorkspaceSockets`, the same call `WorkspaceMemberService.leave` makes
for the same reason), `session.activeOrganizationId` needs no clearing because every one of the
user's sessions is deleted in the same transaction, and the last-owner invariant is enforced
above by the disposition requirement rather than discovered below by the plugin.

### 6. What survives — the tombstone

Three things, and they are chosen so that a deletion never erases the record of itself:

1. **The anonymised `User` row.** It is what keeps the seven foreign keys valid and the content
   readable; it is also the only proof that the account existed at all, which is what makes a
   later "did you actually do it" answerable.
2. **One `account.deleted` activity row per workspace the user was in** — except workspaces
   deleted by a disposition, where it would be removed by the statement it describes (the same
   reason there is no `workspace.deleted` activity type). It carries `targetUserId`,
   `previousRole` and `initiatedBy`, and **no name**: a row written to stop naming somebody must
   not name them. `Activity.userId` is the departing user, not the administrator, so an
   operator's identity never appears in a tenant's feed. It joins `AUDIT_ACTIVITY_TYPES` under
   the access-changing kind.
3. **One `account.deleted` JSON log line**, `warn`, on the transport the access log, the
   retention sweep and `workspace.deleted` already use. It carries the user id, who initiated
   it, and counts — comments rewritten, activities scrubbed, sessions and notifications deleted,
   workspaces transferred and deleted. **It carries no e-mail address and no name**, for the
   same reason ADR 0020's sweep logs counts only: copying the data out to a log aggregator on
   the way to deleting it moves the problem rather than solving it.

### 7. If a deletion was executed in error

It is not reversible in the product, and no undo is planned. The recovery path is the one this
project already rehearses: **restore from the nightly `pg_dump` the backup sidecar writes**
(`BACKUP_KEEP` copies). The procedure is
[Undoing an account deletion](../development.md#undoing-an-account-deletion), a variant of the
existing restore drill: restore the archive into a scratch database rather than over the live
one, and copy back the `User` row and the rows deleted alongside it. Two things make this
narrower than it sounds and are worth stating rather than discovering:

- If a disposition **deleted a workspace**, its rows are gone in exactly the way any workspace
  deletion loses them, and only the dump has them.
- Attachment **bytes** are on disk, not in the dump. They survive a mistaken account deletion —
  this flow never touches the filesystem — until the nightly orphan sweep's grace window passes
  over rows a restored database would have claimed ([ADR 0022](0022-attachment-storage.md)).
  Restoring within that window is what keeps files and rows in agreement.

## Rationale

- **Anonymise rather than delete, because the alternative is not "delete the user" — it is
  "delete other people's history".** Seven `Restrict` foreign keys are not an obstacle that was
  worked around; they are seven statements that this content is not disposable, made at the time
  each relation was added, and 0024 made the seventh knowingly. Relaxing any of them to
  `Cascade` would answer an erasure request by silently removing cards, comments and audit rows
  from workspaces the requester left months ago.
- **The `Restrict` FKs were never the problem, and this ADR relaxes none of them.** DB-05's
  framing — "`Restrict` FKs make deletion impossible" — is true about a `DELETE` and misleading
  about the requirement. Erasure asks that the personal data stop being in the database, not
  that a particular row stop existing. An `UPDATE` satisfies it and keeps every referential
  guarantee the schema makes.
- **`User.id` instead of a hash, because a hash is reversible by guessing.** The address space
  an attacker has to try is not 2^256; it is the list of addresses they already hold.
- **The mention rewrite is the part it is easiest to forget and hardest to detect.** The `User`
  row can be spotless while a thousand comments still spell out the person's name, because the
  name was copied into the body at write time by design (the picker binds `@[Name](id)` so the
  comment renders without a join). An anonymisation that leaves it there is theatre.
- **`targetName` is scrubbed and everything else in `payload` is left alone**, because a rule
  like "scrub any field that looks like a name" over an open `Json` column is a rule that either
  misses the next field or corrupts an unrelated one. The set of payload fields carrying a
  person's name is exactly one today; the ADR names it, and the day a second is added this
  paragraph is what is wrong.
- **The owned-workspace question is asked, not answered.** The audit's note said the decision
  "has to be in the flow, not left to support", and the reason is that both answers are
  catastrophic when guessed: transferring hands a tenant to someone who never asked for it,
  deleting takes other people's work.
- **Immediate rather than scheduled, because the metric is stated in minutes.** The success
  criterion for this item is that an erasure request can be executed in ≤30 minutes. A nightly
  sweep would make the honest answer "within 24 hours" and would put a half-deleted account
  state into the product for the interval.
- **The administrator path exists because the self-service path cannot cover the common case.**
  The person making an Article 17 request has often already stopped using the account; some
  never had a working password. An operator who cannot execute a request they legally must
  execute is back to `psql`, which is where DB-05 started.

## Consequences

- **A GDPR/KVKK erasure request is executable, by the user or by the operator, in one request.**
  Measured: against a workspace with 5 000 tasks, 5 000 comments (2 500 of them mentioning the
  departing user by name), 20 000 activity rows (4 000 carrying `targetName`) and 1 000
  assignments, `DELETE /me` returned in **1 050 ms** end to end — request in, `204` out,
  everything committed. The ≤30-minute metric is bounded by a human reading the preview, not by
  the database. Apple M3 Max, loopback API and Postgres, no proxy and no container in between,
  so treat it as a floor rather than a deployment figure.
- **`DELETE FROM "User"` is still impossible, and still deliberately so.** Nothing in this ADR
  makes an operator's hand-written `DELETE` work. The supported path is the endpoint.
- **A comment thread survives with its structure intact and its author unnamed.** Replies still
  make sense; `@` mentions still resolve; the feed still says a change happened. Nobody can find
  out who.
- **The old e-mail address becomes free.** Someone may sign up again with it, and they get a new
  `User` row and a new id — the content stays with the tombstone, which is the correct outcome
  and also a surprising one if you expected an account to be "restored" by re-registering.
- **A `deletedAt` account keeps a working session cookie for up to five minutes.**
  `session.cookieCache` returns the cached session without a database read
  (`better-auth/dist/api/routes/session.mjs`), so deleting the `Session` rows does not
  invalidate a cookie already issued. The self-service path clears the caller's own cookies on
  the way out, which closes it in the browser that asked. The administrator path cannot. During
  that window the account has no membership anywhere, so every workspace-scoped route answers
  `404` through `WorkspaceGuard`; the two writes that are _not_ workspace-scoped —
  `POST /workspaces` and `PATCH /me` — refuse a tombstone explicitly, at their own entry points.
  A check in `SessionAuthGuard` would close the window fully and was rejected: it would add a
  database round trip to every authenticated request in the product to shorten a five-minute
  window on a rare administrative action.
- **The stored name is a tombstone; the rendered name is translated.** `User.name` holds the
  English `Deleted user`, because an API consumer that is not this web app still needs something
  readable in the field. What a _person_ reads does not come from there: `CommentDto.author` and
  `ActivityDto.author` carry `deleted: boolean`, and the web substitutes a catalogue label
  (`common.deletedUser` — `Silinmiş kullanıcı` in Turkish). Those two DTOs are the complete set,
  checked rather than assumed: memberships, assignments and rosters are all deleted by this
  flow, so an anonymised account cannot appear in `WorkspaceMemberDto` or `TaskAssigneeDto` at
  all, and `AttachmentDto` carries `uploadedById` with no name.

  **A boolean, not the `deletedAt` timestamp.** Both routes are `@WorkspaceScoped()`, so every
  member down to GUEST reads the result, and `docs/architecture.md`'s rule is that a payload
  must never widen who can see something — _when_ a named individual asked to be erased is a
  fact about that person which nothing on either screen needs. The boolean is also the whole of
  what a client legitimately acts on, and it is a contract gap independent of language: a
  tombstoned author should not be a profile link or a mention-picker entry, and before this the
  web could not tell a tombstone from a live member who had typed `Deleted user` as their name.

  **One exception, by necessity.** The display name inside a comment's mention markup
  (`@[Deleted user](<id>)`) stays English. It is stored text in `Comment.body`, rewritten once at
  anonymisation time with no reader's locale in scope, and there is no later moment at which a
  locale is available to it. So a Turkish thread can show the translated byline beside an English
  mention token. That is stated here rather than left to be discovered.

- **Deleting an account is a write to other people's workspaces.** Members see a roster shrink
  and an `account.deleted` entry in their feed. That is intended — the alternative is a card
  assigned to nobody and a comment from a name that no longer appears anywhere.
- **`Verification` is swept by address, and that reaches less than it sounds like.** Measured
  rather than assumed: on this deployment Better Auth 1.6 puts an address in
  `Verification.identifier` for **no** flow. E-mail verification is a JWT signed with the secret
  and writes no row at all; password reset stores `reset-password:<opaque token>`. The address
  only lands in that column through the OTP and magic-link plugins, which are not enabled. So
  the deletion removes every verification row that names the person — currently none — and the
  token-shaped rows are left to their own expiry, which ADR 0020's nightly sweep already
  enforces and which discloses no address in the meantime.
- **Data portability (Article 20) is explicitly out of scope**, as the phase plan states. This
  item is erasure. An export is a separate piece of work and pretending otherwise here would
  have produced a worse version of both.
- **One nullable column, one migration, no index.** `deletedAt` is read by primary key
  (`WHERE id = $1`) and never scanned, so an index on it would be maintained on every user write
  to serve no query — the discipline migration `20260814150000_drop_unused_indexes` established.

## Alternatives considered

| Alternative                                                                      | Why not                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relax the seven `Restrict` FKs to `Cascade` and hard-delete the `User` row       | Answers an erasure request by deleting other people's cards, comments and audit rows. Each `Restrict` was a decision that this content outlives its author; 0024 made the most recent one on purpose                         |
| Relax them to `SetNull` and hard-delete the row                                  | Six of the seven columns are `NOT NULL` and one is half of a composite key, so this is a schema rewrite. It also loses the join that makes an audit trail an audit trail: "somebody" did this                                |
| Enable Better Auth's `user.deleteUser`                                           | It hard-deletes the `user` row after the hooks run, so it fails on the first `Restrict` FK for any account that ever created a card. Its value was the trigger, and the trigger is the cheap part                            |
| Hash the e-mail address instead of deriving from `id`                            | A hash of a known address is checkable, so it is pseudonymisation, not anonymisation — the account's former existence stays confirmable by anyone holding a list of addresses                                                |
| Keep `name` and only clear `email`                                               | The name is the identifier that is actually on screen, in every comment header and every feed row. Clearing the address the person cannot see and keeping the name they can is the wrong half                                |
| Delete the departing user's comments and activity rows                           | Rewrites shared history: replies lose the message they answer, and the record of who changed a board loses the changes. `Comment.user` is `Restrict` for exactly this reason ([ADR 0012](0012-comment-delete-authorship.md)) |
| Transfer a solely-owned workspace automatically (oldest member, longest-serving) | Hands a tenant, its data and its billing-shaped responsibility to someone who never agreed to it. The audit's own note requires the decision to be in the flow                                                               |
| Delete solely-owned workspaces automatically                                     | Takes other people's boards with it as a side effect of one person leaving. That is the "silent cascade is a catastrophe" case the phase plan names                                                                          |
| Refuse deletion while the user owns a workspace                                  | Makes an obligation contingent on the user first performing an unrelated administrative task, and leaves an operator with a request they cannot fulfil                                                                       |
| Run the deletion through the nightly retention sweep (ADR 0020)                  | The sweep enforces a policy on a schedule with nobody waiting; this executes a request with somebody waiting. It would also introduce a half-deleted account state for up to a day                                           |
| A grace period with a cancel window                                              | Article 17 says "without undue delay", and the state machine (half-alive account, cancellation, re-authentication into a deleted account) is real complexity bought for a problem the backups already cover                  |
| Self-service only, no administrator path                                         | Leaves the operator back at `psql` for the requests that actually arrive — from people who no longer have working access to the account                                                                                      |
| Administrator only, no self-service path                                         | Makes the operator a ticket queue for a decision that is the user's to make, and every self-hoster becomes a data-protection helpdesk                                                                                        |
| Check `deletedAt` in `SessionAuthGuard`                                          | Closes a five-minute window on a rare action by adding a database round trip to every authenticated request in the product. The two reachable writes are closed at their own entry points instead                            |
| Expose `deletedAt` on the author DTOs instead of `deleted`                       | One character cheaper and publishes a per-person erasure date to every member of the workspace, down to GUEST. The client acts on _whether_, never on _when_                                                                 |
| Let the web detect a tombstone by comparing `name` to `Deleted user`             | `Deleted user` is a display name any live account is free to type, so the check is wrong for that person and silently wrong for a future rename of the constant                                                              |
| A soft-delete `deletedAt` tier on every table instead                            | That is finding DB-06, a different problem (recovering from an accidental delete), and a retention or erasure design whose rows are still in the table has erased nothing                                                    |
