# 0027. Attachment Storage Quotas: Soft Byte Ceilings per Workspace and per Instance

**Status:** Accepted
**Date:** 2026-08-18

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0027-attachment-quotas.md)

> **Updated (2026-08-21):** the "unset means unlimited" half of the decision below is
> reversed. An unset `ATTACHMENT_WORKSPACE_QUOTA_BYTES` now means 2 GiB and an unset
> `ATTACHMENT_INSTANCE_QUOTA_BYTES` means 20 GiB; a written `0` is still the opt-out and a
> negative value is still refused at boot. The "a default quota number" row under Alternatives
> considered is therefore no longer rejected. What changed the answer: the finding this ADR
> exists for (SEC-02, 2026-08-18 audit) is _unbounded_ consumption, and on the published Compose
> topology an unconfigured instance shares its disk with Postgres, so the operator who never
> reads the quota section is exactly the operator whose database a full disk takes down. A
> default that is wrong for a 2 TB volume costs that operator one line in `.env`; a default that
> is wrong for a 20 GB volume costs the instance. The same change gives the upload route the byte
> budget the third deferral below pointed at (`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`, 256 MiB per
> client IP per minute, `UploadBudgetGuard`), so the per-request throttle is no longer the only
> brake on an unconfigured instance. Upgrade consequence and the usage query are in
> [self-hosting.md](../self-hosting.md#attachment-quotas-now-have-defaults). The body below is
> left as written.

## Context

The attachment upload path has a per-file ceiling (`ATTACHMENT_MAX_BYTES`, [ADR 0024](0024-attachment-kinds-and-serving-policy.md))
and a per-IP request throttle, and nothing that bounds the _total_. `rate-limit.ts` has said so
in plain words since the day the throttle shipped: the throttler counts requests, which is the
wrong unit for disk, and "the real ceiling is `limits.fileSize` plus a per-workspace quota that
does not exist yet." The 2026-08-18 audit filed that sentence as SEC-02: at the defaults, one
authenticated client can spend `ATTACHMENT_UPLOAD_RATE_LIMIT × ATTACHMENT_MAX_BYTES` ≈ 500 MiB
of disk **per minute**, indefinitely — and on the published Compose topology `STORAGE_PATH`
shares a filesystem with Postgres, so filling it does not degrade attachments, it takes the
instance down. This ADR supplies the missing quota.

## Decision

**Two ceilings, both environment-configured, both off by default.**
`ATTACHMENT_WORKSPACE_QUOTA_BYTES` caps the summed `size` of one workspace's FILE attachments;
`ATTACHMENT_INSTANCE_QUOTA_BYTES` caps the same sum over the whole instance. Both are parsed in
`storage-config.ts` beside `ATTACHMENT_MAX_BYTES`, with `envInt`; a negative value is refused at
boot.

**Unset or `0` means unlimited.** That is the upgrade behaviour — an instance that never sets
the variables keeps exactly the upload path it had, query for query — and it is this codebase's
established spelling twice over: features are enabled by a value being present (`STORAGE_PATH`,
`SMTP_HOST`), and `0` already means "no window" for the retention sweeps
([ADR 0020](0020-data-retention.md)). There is no default number to argue about because no
number is right for both a Raspberry Pi and a 2 TB volume; the operator who has a disk budget
states it.

**The quota is enforced at upload, over live rows, inclusively.** `createFile` runs
`SUM(size) WHERE kind = 'FILE'` (scoped to the workspace, then unscoped for the instance check)
and rejects when the sum plus the incoming file would _exceed_ the quota — a file that fills it
exactly is accepted, matching `ATTACHMENT_MAX_BYTES`'s own inclusive ceiling. The check runs
after the MIME sniff (a refused type is refused whatever the quota says) and before the byte
write (an over-quota upload never touches the disk). When both quotas are `0`, no query is
issued at all.

**The quota is soft, and this is a named decision rather than an oversight.** The check is
check-then-write: N concurrent uploads that each pass can each land, overshooting a quota by at
most one file apiece — bounded by `ATTACHMENT_MAX_BYTES` per request. Closing that window with
a per-workspace advisory lock or a reservation row was considered and rejected: it serializes
every upload in a workspace, or invents a bookkeeping row that must itself be cleaned up on
failure (a second orphan class), to defend byte-exactness that nothing needs — the threat model
is _unbounded_ consumption, and the overshoot is bounded. **Trigger:** a measured deployment
where concurrent overshoot materially exceeds one `ATTACHMENT_MAX_BYTES`, or an operator report
of the quota being raced deliberately. **Cost when triggered:** a transaction-scoped
`pg_advisory_xact_lock` keyed on the workspace id around the check and the row write — a change
to `createFile` only.

**LINK attachments cost nothing.** A LINK stores no bytes (`size` is `null`,
[ADR 0024](0024-attachment-kinds-and-serving-policy.md)), so it neither counts against a quota
nor is refused by a full one. The `kind = 'FILE'` predicate in the sum is that sentence as SQL.

**Rejection is a 413 whose `error` field is its own.** The envelope carries
`error: "Attachment Quota Exceeded"` — a constant in `@kurul/shared-types`, written once by the
API and branched on by the web — where the per-file limit's 413 carries the stock
`"Payload Too Large"`. Clients branch on `statusCode` and `error`, never on `message`
([api-conventions.md](../api-conventions.md#errors)), and this is the first pair of failures on
one route where the status alone cannot say which fix to suggest: a smaller file cannot fix a
full workspace. `507 Insufficient Storage` was rejected: `AllExceptionsFilter` reports every
5xx to error tracking by design, and a quota refusal is the API working as configured, not a
server fault.

**Deferred, each with a trigger:**

- **Per-user quotas.** **Trigger:** the first report of one member exhausting a shared
  workspace quota. **Cost when triggered:** a third variable and the same aggregate keyed on
  `uploadedById`.
- **A usage read (endpoint and panel copy).** **Trigger:** the first support thread where a
  user cannot tell how full their workspace is before the 413 tells them. **Cost when
  triggered:** one read endpoint answering the sum this check already computes, plus UI.
- **Re-keying the upload throttle by user/workspace.** Unchanged from ADR 0022's deferral; the
  quota is now the real ceiling the throttle was never pretending to be.

## Rationale

**Why a `SUM` at upload time and not a stored usage counter.** A denormalized counter drifts
the first time a delete misses it, and here every bulk delete misses it by construction:
`Workspace → Board → Task` cascades entirely inside Postgres with no application code running
(the exact property that already forces the orphan sweep, ADR 0022). The sum over live rows is
correct by definition after any cascade. No index is added for it — the measure-first precedent
([ADR 0020](0020-data-retention.md)'s #187 update and the `drop_unused_indexes` migration before
it): the aggregate rides the existing relation join, uploads are throttled to 20/min/IP, and the
check does not run at all on unconfigured instances. An index earns its place with a measurement,
not a fear.

**Why the quota counts rows, not disk.** The database is authoritative; the disk lags it in
both directions (bytes written before the row commits, orphans waiting out the sweep's grace
period). A quota measured with `du` would charge tenants for orphans that belong to nobody.
Consequence honestly stated: detaching a file frees quota immediately while its bytes wait for
the sweep, so _disk_ usage can exceed the quota accounting by the orphan population until the
grace window passes.

## Consequences

- The stale sentence in `rate-limit.ts:44-52` is rewritten to point at the quotas; ADR 0022's
  "rate limiting is named as insufficient" paragraph now has its other half.
- `.env.example`, `development.md`'s environment table, `self-hosting.md`'s sizing section and
  `api-conventions.md`'s 413 row all gain the two variables and the error shape, with Turkish
  mirrors in the same PR.
- The web upload error path branches on the envelope's `error` for the first time
  (`resolveApiMessage` gains `byError`); new copy lands in both catalogs.
- An operator sizing a disk budgets: instance quota + one `ATTACHMENT_MAX_BYTES` per plausible
  concurrent upload (the soft overshoot) + the orphan population of one grace window.

## Alternatives considered

| Alternative                               | Why not                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hard quota (advisory lock or reservation) | Serializes a workspace's uploads, or creates a bookkeeping row that is itself a cleanup problem, to close an overshoot already bounded by one file |
| Denormalized usage counter on `Workspace` | Every cascade delete runs inside Postgres with no code to decrement it; drifts permanently on the paths that free the most space                   |
| A default quota number                    | No number fits both a Raspberry Pi and a 2 TB volume; a default that rejects uploads after an upgrade is a regression nobody configured            |
| `507 Insufficient Storage`                | Every 5xx is reported to error tracking by the filter's signal policy; a quota refusal is configuration working, not the server breaking           |
| Distinguishing the 413s by `message`      | api-conventions forbids branching on `message`; the `error` field exists for exactly this                                                          |
| Counting LINK rows against the quota      | A LINK stores no bytes; a byte quota on nothing would refuse free rows while the disk stays empty                                                  |
| Measuring the disk (`du`) instead of rows | Charges tenants for orphans awaiting the sweep and races the grace period; the database is the authority on what exists                            |
