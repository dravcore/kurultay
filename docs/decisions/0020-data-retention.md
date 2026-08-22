# 0020. Data Retention: Per-Table Windows Enforced by a Nightly Sweep

**Status:** Accepted
**Date:** 2026-08-14
**Updated:** 2026-08-18 — `WorkspaceInvitation` joins the sweep as an additional window on top of the original four below, `INVITATION_RETENTION_DAYS` (default 90 days from `createdAt`, finished rows only): the table list below omitted the one address in the schema that need not belong to a user (audit finding DB-01).
**Updated:** 2026-08-18 — the Consequences section's "no index was added for the sweep's own predicates" no longer holds for two of the four tables below: migration `20260814180000_retention_sweep_indexes` adds `Session_expiresAt_idx` and `Verification_expiresAt_idx`, after measuring the sweep at production-like volume found each on a sequential scan of the whole table (issue #187). The same migration also adds `UsagePing_createdAt_idx`, but `UsagePing` is not one of the four tables this ADR lists; it is the telemetry-ping table the sweep also covers, added by [ADR 0021](0021-activation-funnel-and-opt-in-telemetry.md). `Activity.createdAt` and `Notification.readAt` are deliberately left alone — both already reach an index through a different leading column despite this ADR's prediction otherwise, so the trade-off below still holds for those two. This is the ADR's own "revisit only if a sweep is observed to outlast its window" clause working as designed: the decision was revisited on measurement, not assumption, and only where measurement asked for it.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0020-data-retention.md)

## Context

Until this decision, Kurul deleted a row only when a user asked it to. There was no
scheduled job of any kind except the due-soon scan, which only ever inserts. Four tables grew
without bound:

| Table          | What accumulated                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `Session`      | `ipAddress`, `userAgent` — kept forever, including for sessions that expired months ago                 |
| `Verification` | `identifier`, which is an e-mail address, plus the token value                                          |
| `Notification` | `payload` (task titles), `readAt` — every notification any user ever read                               |
| `Activity`     | append-only by design; the migration that indexed it calls it "the fastest-growing table in the schema" |

Two separate problems live in that table.

**The compliance one is the sharp one.** GDPR Article 5(1)(e) and KVKK Article 4 both say
personal data is kept no longer than the purpose requires. An expired session's IP address
serves no purpose at all — the row cannot authenticate anybody. Neither can a redeemed or
expired verification token, which is a bare record that _this e-mail address_ asked for
something on _this date_. A self-hoster running Kurul in the EU or Turkey currently has no
answer to "how long do you keep this?", because the answer is "forever, and nothing in the
product says otherwise". That is a documentation failure as much as a code one: a retention
period that exists only in someone's head is not a retention policy.

**The operational one is slower.** Notification and Activity are the two tables that grow with
usage rather than with the number of users, and they are in every `pg_dump` the backup sidecar
writes (`BACKUP_KEEP` copies of it). Unbounded growth there inflates backup size, restore time
and autovacuum work long before it inflates query time — the indexes are good, so reads stay
fast while the storage bill does not.

`Activity` is the one that needs an actual judgement call rather than a rule. The dashboard's
throughput series reads a fixed 14-day window (`dashboard.service.ts`), so 14 days is all the
_aggregates_ need. But the activity feed is a user-facing promise of history: "who moved this
card, and when". Those two numbers are three orders of magnitude apart, and picking either one
by itself gets the feature wrong.

## Decision

Each table gets a stated retention window, enforced nightly by a single global sweep
(`apps/api/src/retention/cleanup.worker.ts`, BullMQ, one run per day):

| Table          | Window                                                    | Setting                       |
| -------------- | --------------------------------------------------------- | ----------------------------- |
| `Session`      | until `expiresAt` — not configurable                      | —                             |
| `Verification` | until `expiresAt` — not configurable                      | —                             |
| `Notification` | 90 days **after `readAt`**; unread rows are never deleted | `NOTIFICATION_RETENTION_DAYS` |
| `Activity`     | **365 days after `createdAt`**                            | `ACTIVITY_RETENTION_DAYS`     |

`CLEANUP_ENABLED=false` disables the sweep entirely. Either window may be set to `0`, which
means "keep forever". Nothing else is deleted: `User`, `Account`, `Comment`, `Task` and the
workspace tree are untouched by retention and are removed only by an explicit user action.

**The `Activity` answer is delete at one year, not archive and not keep.** One year is chosen
because it covers every question the feed is actually asked — "what happened on this board
last quarter", "who changed this before the release" — and because it is the shortest window
that survives an annual review cycle without a user noticing the horizon. Archiving to cold
storage is rejected outright, not deferred: Kurul deploys as a Compose stack with a
Postgres volume and no object store ([ADR 0001](0001-monorepo-modular-monolith.md)), so an
"archive" would be a file on the same disk that nobody reads and nobody restores. The backup
sidecar already writes `BACKUP_KEEP` full `pg_dump` archives — _that_ is the cold copy, and an
instance that needs year-old activity for an audit restores one.

The sweep is deliberately **global and un-scoped by `workspaceId`**, which is the one place in
this codebase that rule is broken on purpose. It runs with no request, no session and no
tenant behind it; `Verification` has no tenant column to scope by, and an expired session
belongs to a user rather than to a workspace. The multi-tenant rule in `CLAUDE.md` exists to
stop a _caller_ reading across tenants, and nothing here is reachable by a caller — there is
no route that triggers a sweep, by design.

Deletion is batched: 1000 rows per `DELETE`, looping until a batch comes back short, with a
1000-batch ceiling per table per run.

## Rationale

- **`expiresAt` needs no policy, only enforcement.** The row already carries the moment it
  stopped being useful. Adding a knob would only let an operator choose to keep an IP address
  attached to a session that cannot authenticate anyone — a setting whose only possible use is
  getting the compliance answer wrong.
- **Notification retention is measured from `readAt`, not `createdAt`,** and unread rows are
  exempt at any age. A notification is a message to a person; the clock starts when they have
  actually received it. Deleting an unread one would silently drop something the badge already
  told them was waiting.
- **Ninety days is the shortest window that does not change behaviour.** The notification list
  is a working inbox, not an archive: nothing in the web reads a notification that old, and
  `unreadCount` never sees these rows at all.
- **One year for Activity is a floor set by how the feed is used, not by storage.** Fourteen
  days would have been defensible from the dashboard's query alone and is wrong from the
  product's: the feed is where "who did this" gets answered, and that question outlives a
  fortnight. Conversely, keeping forever makes every restore slower and every dump larger to
  answer a question nobody asks about the third year.
- **The windows are configurable because the obligations are not universal.** A team with a
  statutory audit-trail duty sets `ACTIVITY_RETENTION_DAYS=0`; a team with a data-minimisation
  duty sets it to 30. A defaults-only design forces one of those two to patch the code.
- **Batched deletes, not one statement per table.** The first run after this ships has to clear
  whatever history an instance accumulated. A single unbounded `DELETE` holds row locks and an
  open transaction for that entire duration, and autovacuum cannot reclaim any of the dead
  tuples until it commits, so peak bloat scales with the total rather than with a batch. The
  price is that each batch re-evaluates its predicate from the start of the table; that is
  acceptable for a job that runs once a night off any request path, and after the first run
  each table is one short batch.
- **The log line carries counts and nothing else.** The rows being deleted are exactly the IP
  addresses, user agents and e-mail addresses the policy exists to remove; copying any of them
  into a log aggregator on the way out would move the problem rather than solve it. The line is
  emitted even when every count is zero, because a job that silently does nothing and a job
  that is silently unscheduled look identical otherwise.
- **`CLEANUP_ENABLED` is re-read on every run, not once at boot.** A BullMQ job scheduler lives
  in Redis, not in the process that registered it; a replica restarted with the switch off
  would otherwise still act on a definition left behind by an older one. Checking at the point
  of deletion is what makes the switch mean "delete nothing".

## Consequences

- Expired `Session` and `Verification` rows stop existing within a day of expiring. That is the
  compliance claim this ADR licenses the project to make, and the integration suite
  (`test/retention-cleanup.e2e-spec.ts`) asserts the counts are zero after a sweep.
- A read notification disappears after 90 days. There is no UI that says so and no undo. This
  is judged acceptable because the notification list is an inbox — but it is a real behaviour
  change for any instance already running.
- Activity older than a year disappears, and with it the only in-product record of those
  events. `Notification.activityId` is `ON DELETE SET NULL`, so notifications that referenced a
  swept activity survive with a null link rather than disappearing — a notification's own
  payload already carries what it needs to render.
- That referential action forced a new index (`Notification_activityId_idx`, migration
  `20260814090000`). Postgres runs `SET NULL` per deleted row, and with no index leading on
  `activityId` each deleted activity meant one sequential scan of the whole Notification table.
  The index costs a little on every notification insert; without it this feature is unshippable.
- **No index was added for the sweep's own predicates.** `Session.expiresAt`,
  `Verification.expiresAt`, `Notification.readAt` and `Activity.createdAt` are all scanned. That
  is a deliberate trade: an index on each would be maintained on every insert into the two
  fastest-growing tables in the schema, to speed up a query that runs once a night with nobody
  waiting for it. Revisit only if a sweep is observed to outlast its window.
- Retention is now a documented, testable property of the product rather than an assumption.
  Changing a default means changing this ADR.
- This ADR does **not** address deletion on request (GDPR Article 17 / KVKK Article 7). A user
  asking for their account to be erased still has no path, because `Restrict` foreign keys make
  a bare `DELETE FROM "User"` impossible by design. That is a separate decision about
  anonymisation, and this sweep neither helps nor hinders it.

## Alternatives considered

| Alternative                                                          | Why not                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `Activity` forever                                              | Leaves the audit's actual question unanswered, and grows the one table every backup and restore has to carry, to serve a query nobody makes about the third year                |
| Trim `Activity` to the 14 days the dashboard reads                   | Optimises for the aggregate and breaks the feature: the feed promises history, and "who moved this card last month" is its most common use                                      |
| Archive `Activity` to cold storage before deleting                   | There is no cold storage in the deployment model — an archive would be a file on the same volume, unread and untested. The `pg_dump` sidecar already is the cold copy           |
| Delete notifications by `createdAt` instead of `readAt`              | Would delete unread notifications purely for being old, dropping messages the badge already promised the user                                                                   |
| Postgres `pg_cron` / a `TTL` extension                               | Puts the policy in the database rather than in the application, where it cannot be unit-tested, cannot be switched off per deployment, and is invisible to `prisma migrate`     |
| A single unbounded `DELETE` per table                                | One long transaction on the first run: locks held throughout, dead tuples unreclaimable until commit, and peak bloat proportional to the whole backlog                          |
| A `deletedAt` soft-delete tier before the hard delete                | Solves a different problem (accidental user deletion, finding DB-06); a retention sweep whose rows are still in the table has not enforced any retention                        |
| Scope the sweep per workspace to keep the multi-tenant rule unbroken | `Verification` has no `workspaceId` and `Session` belongs to a user; the loop would exist only to preserve the shape of a rule whose purpose (caller isolation) is not at stake |
