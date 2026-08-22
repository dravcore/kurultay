# 0022. Attachment Storage: Local Disk Behind a Port, Served From the API Origin

**Status:** Accepted
**Date:** 2026-08-14

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0022-attachment-storage.md)

## Context

Kurul has been telling people it cannot do this, and telling them why. `README.md` lists "no
task attachments" among the things the product is not at `v0.1.0` and points at
[ROADMAP.md — Beyond MVP](../../ROADMAP.md#beyond-mvp), where the entry reads `Task attachments —
Needs an object-storage decision (ADR)`. [tech-stack.md](../tech-stack.md) says the same thing
from the other side: "File attachments are out of MVP scope. When added, pick an S3-compatible
store." This document is the decision both of them are waiting on.

The audit that scheduled this work put attachments first among three table-stakes gaps, ahead of
checklists and Trello import, as the most frequently asked-for missing feature. Competing
self-hosted boards treat it as baseline. A team evaluating a migration asks three questions —
can I bring my boards, can I put files on cards, do I have checklists — and a "no" to any of
them ends the evaluation before the differentiators are ever reached.

**The storage question is harder than the feature.** Attachments are the first thing Kurul
stores that is not a row in Postgres, and every operational promise made so far was made about a
database. The nightly backup runs one command, `pg_dump --format=custom`; the `backup` service
mounts its own script and the backup volume and nothing else. The rehearsed restore's definition
of success is entirely database-shaped — reproducing all 17 tables, every row count, all 59
indexes. **A restore drill would pass at 100% with every uploaded file gone.**

[ADR 0020](0020-data-retention.md) has already answered a version of this question, and answered
it no: cold-storage archiving was rejected outright because "an archive would be a file on the
same disk that nobody reads and nobody restores". Attachments bring exactly the thing that
sentence forbids. That objection is not answered by files being user-visible — a user reads the
file, but nobody reads it _as a backup_. It is answered only by the copy being read and restored
on the same rehearsed schedule as the dump.

The deployment target is what keeps the question genuinely open rather than a matter of taste.
Kurul ships as a Compose stack on one machine ([ADR 0001](0001-monorepo-modular-monolith.md))
to an audience promised a five-minute install. Requiring MinIO or an S3 account to attach a PDF
breaks that promise for the majority in order to serve the minority who already run object
storage; hard-coding `fs` strands that minority and makes the eventual move a rewrite.

## Decision

**Storage is a port with one implementation.** `StorageBackend` is an interface with
`write`, `read`, `remove`; `DiskStorageBackend` is the only implementation that ships. The shape
copies `MailSender` exactly — a plain interface, plain adapter classes that are not
`@Injectable()`, a pure `createStorageBackend(config)` factory, a process-wide singleton with a
reset hook, and a narrow `StorageService` as the only thing the module exports. The capability
bit is separate from the identity, as `deliversMail` is from `transport`: code branches on
`persistsFiles`, never on `backend === 'disk'`.

**Configuration follows the `SMTP_HOST` pattern: presence enables.** `STORAGE_PATH` set means
attachments work; unset means the feature is off and `StorageConfig.disk` is `undefined` — a
type-level state, not a flag. There is no `ATTACHMENTS_ENABLED`. This codebase reserves `_ENABLED`
booleans for default-on kill switches (`CLEANUP_ENABLED`, `RATE_LIMIT_ENABLED`) and for consent
(`TELEMETRY_ENABLED`); a default-off feature that needs a value to work does not get one.
`GET /config` grows `attachmentsEnabled` so the web knows whether to render the control.

**S3 is deferred, not dismissed.** `StorageBackend` is designed so `S3StorageBackend` is an
added file rather than a refactor, and the SDK is loaded with `await import()` when it arrives —
the reason `smtp-mail-sender.ts` lazy-loads nodemailer applies more strongly to a ~10 MB AWS
SDK. **Trigger:** the first operator report of a deployment where local disk is not durable
(a container host with ephemeral storage, or a multi-replica install). **Cost when triggered:**
one adapter file, one config branch, one lazy import — not a change to the endpoints, the model,
or the port.

**The backup grows a second job.** The attachments volume is mounted read-only into the `backup`
service and archived beside the dump in the same run, pruned on the same `BACKUP_KEEP` schedule.
The restore procedure grows a matching step and the drill's success criteria grow a file count.
Without this, `ADR 0020`'s reasoning is contradicted rather than extended.

**Orphaned files are swept, with a grace period no shorter than the oldest restorable dump.**
`Workspace → Board → Task` is `Cascade` the whole way down, so one `DELETE FROM "Workspace"`
removes thousands of attachment rows inside Postgres with no application code involved. File
deletion cannot be a side effect of the delete path; orphan production is bulk and silent. The
sweep joins the existing nightly `cleanup.worker`, reports into `CleanupCounts`, and logs counts
only — never paths, per `ADR 0020`'s logging rule. It only considers files whose mtime is older
than `BACKUP_KEEP × BACKUP_INTERVAL`.

**Files are served from the API origin, under `/api/*`, with authorization on every request.**
The proxy contract reserves `/auth/*` for Better Auth, so an attachment endpoint lives under
`/api/*` by elimination — which is also the safe half of the origin. Endpoints follow the
resource-naming rule: the collection nests under its task, the single resource is addressed
shallowly, and the download gets an action segment.

```
GET    /workspaces/:workspaceId/tasks/:taskId/attachments
POST   /workspaces/:workspaceId/tasks/:taskId/attachments
GET    /workspaces/:workspaceId/attachments/:attachmentId
GET    /workspaces/:workspaceId/attachments/:attachmentId/content
DELETE /workspaces/:workspaceId/attachments/:attachmentId
```

**Signed URLs are deferred.** **Trigger:** the first of an external share link, an image embedded
in outbound email, or a CDN in front of the proxy. **Cost when triggered:** a second, separate
endpoint plus a Redis deny-list for revocation — not a change to this one.

**Nothing is written to the response until every check has passed.** Authorization, existence and
size checks complete before the first byte. Once the stream has started, a failure ends the
response with `res.destroy()` and never reaches `AllExceptionsFilter`.

**Validation is an allowlist plus content sniffing, and rejection is a 415.** The declared
`Content-Type` and the extension both come from the caller and neither is evidence; `file-type`
reads the magic bytes. Rejections throw `UnsupportedMediaTypeException`.

**The size limit is set in two layers.** Multer's `limits.fileSize` in the API, and a body-size
row added to the published proxy contract. `POST` gets a `ThrottleUploads()` decorator modelled
on `ThrottleInvitations()`; the download endpoint gets a limit _higher_ than the 100/min default.

**Inline preview covers images only.** `frame-src 'none'` and `object-src 'none'` on the web
origin, plus `frame-ancestors 'none'` and `X-Frame-Options: DENY` on the API, make an in-modal
document viewer impossible without loosening policy on both sides. **Trigger:** a measured
request for document preview; the cost is a scoped CSP relaxation, argued separately.

## Rationale

**Why the API origin and not the web origin.** The web app's CSP carries
`script-src 'self' 'unsafe-inline'`, so a markup injection there can already run inline script;
adding attacker-supplied content to that origin compounds an existing weakness. The API's CSP is
`default-src 'none'`, so a user-uploaded HTML file opened as a document from there can load
nothing at all. `security-headers.ts` names this exact vector in the comment above
`X-Content-Type-Options` — "a user-uploaded file served as `text/plain` that a browser decides to
render as HTML". Attachment responses additionally take
`Cross-Origin-Resource-Policy: same-origin`, overriding the `cross-origin` policy the API sets
globally, because nothing off-origin should be embedding them.

**Why per-request authorization rather than signed URLs.** A signed URL cannot move
authorization to the proxy here. Caddy is deliberately dumb — three `handle` rules, `admin off`,
no auth directives — and [self-hosting.md](../self-hosting.md) promises the operator may swap it
for nginx or Traefik. Signature checking would run inside the API regardless, so the only thing
a signed URL buys is skipping the guard chain, and the guard chain is where this codebase keeps
tenant isolation. Skipping it costs specifically: `@Public()` leaves `request.user` unset, which
makes `WorkspaceGuard` throw before it can check membership, so `@WorkspaceScoped()` becomes
unusable and the tenant check becomes a hand-written copy of `workspaceMember.findUnique` —
including the 404-not-403 rule that keeps attachment existence from leaking. It also has no
revocation: a removed member's session stops working within the 60-second cookie cache, while
a distributed signed URL stays valid until its TTL expires. In the published image's topology —
one origin, `/api` path, `SameSite=Lax` — cookies ride along on `<img src="/api/…">` and
`<a download>` without any of that, so the advantage a signed URL exists to provide is already
unnecessary.

**Why the ordering rule around the stream.** `AllExceptionsFilter` ends with an unconditional
`response.status(statusCode).json(problem)`, and there is no second error format anywhere in the
API. If a handler has already written `Content-Disposition` and started streaming when a disk or
database error arrives, that call raises `ERR_HTTP_HEADERS_SENT`; the client silently receives a
truncated file while Sentry records a 500. This is the one error class the filter does not cover,
and it exists only because this is the first endpoint that returns something other than JSON.

**Why MIME rejection must be a 415 specifically.** Nest's `transformException` maps
`LIMIT_FILE_SIZE` to `PayloadTooLargeException`, so a too-large upload lands in the right envelope
for free. Its last line, however, returns anything it does not recognise unchanged — so a plain
`Error` thrown from a `fileFilter` arrives at the exception filter's `instanceof Error` branch and
becomes a 500 reported to Sentry. A user attaching the wrong file type would be logged as a
server fault. Throwing `UnsupportedMediaTypeException` is what keeps the user's mistake the
user's.

That rule is mechanically guaranteed rather than hopeful, and the guarantee is worth naming:
`transformException` opens with `if (!error || error instanceof HttpException) return error`, so
any Nest HTTP exception passes through untouched. The rule does not depend on multer recognising
anything.

**One hazard in the same function, which no type checker can catch.** Its `switch` matches on
`error.message`, not on a type — so an error whose message happens to equal one of multer's
string constants is silently converted. A hand-written storage error reading `File too large`
would arrive at the client as a 413 it never chose. Nothing in the compiler notices a string
collision, so the storage module's own error messages are written to avoid multer's constants
deliberately, and this paragraph is the only place that rule is recorded.

**Why the proxy contract needs a body-size row.** The contract is published as non-negotiable
and lists nginx equivalents so the operator can replace Caddy. It says nothing about request body
size, and that silence is not neutral: Caddy sets no limit, so uploads work, while nginx defaults
`client_max_body_size` to 1 MB, so the same upload fails with a `413` the operator cannot trace to
anything written down. The operator who followed the documentation most carefully is the one who
gets the broken install. Multer's own `limits.fileSize` default is unlimited — the same kind of
unwritten decision, and it is set explicitly for the same reason.

**Why the grace period is tied to the backup window.** "On disk and not in the database" is a
correct predicate only while the database is authoritative. After a restore it is not:
`DROP DATABASE` and `pg_restore` rewind the rows while the disk stays where it was. Files
uploaded after the dump was taken exist with no row to match, and a sweep run that night would
delete them permanently — the restore and the sweep are each safe alone and destructive together.
Tying the grace period to `BACKUP_KEEP × BACKUP_INTERVAL` means no file can be swept while a dump
old enough to disown it is still restorable. The same window covers the smaller race with an
in-flight upload whose row has not committed.

The constant is borrowed rather than invented, which is the point: that rotation is not a
documented intention but a rehearsed behaviour — the Phase 0 backup work exercised it and
demonstrated the 9-to-7 prune. The sweep is therefore keyed to something that has been observed
to hold, not to a number chosen because it sounded safe.

**Why `MailSender`'s skeleton is copied but its policy is not.** `sendWith` contains delivery
failures deliberately: "transactional mail is a side effect of a request, never its result: a
signup must not fail because the relay refused the connection." Storage inverts that. A failed
write must fail the request, or the database keeps an attachment row whose bytes do not exist.
The most characteristic decision in the module being imitated is the one decision not to imitate,
which is worth writing down precisely because someone reading the precedent would copy it.

## Consequences

**Documentation this falsifies on the day it ships.** `development.md`'s "all 17 tables" — the
schema has exactly 17 models today and `Attachment` makes it 18. Its restore verification, which
checks `\dt` and three row counts and nothing on disk. Its paragraph naming Redis as the one
thing deliberately not backed up "because it is all rebuildable", which now needs a second entry
with the opposite reasoning. `.env.example`'s "Scheduled **database** backups". `backup.sh`'s
header comment scoping itself to "the Kurul database". `configure-app.ts`'s CSP comment,
"This service only ever answers with JSON". `api-conventions.md`'s requirement of
`Content-Type: application/json; charset=utf-8` on every response with a body, which gains a
documented exception, and its status-code table, which lists neither 413 nor 415. The Turkish
mirrors of all of the above move in the same PR.

**The API becomes stateful.** The `api` service has no `volumes:` key today. This adds the first
one, and with it the first deployment constraint naming which host a replica may run on. The
service runs as `USER node` under `cap_drop: [ALL]` and `no-new-privileges`, and the compose
comment claims it "never chowns" — so the upload directory is created in the image already owned
by `node` rather than fixed at runtime, and that claim stays true.

**The sweep breaks the retention module's shape, and says so.** All five existing sweeps are
`$executeRaw` batched deletes: pure SQL, implicit per-batch transaction, idempotent, no side
effects, fitting `deleteInBatches`'s `() => Promise<number>` signature. Unlinking a file is none
of those things — not transactional, not reversible. The orphan sweep lives in the same worker
and reports into the same counts, but does not reuse that helper.

**A new test convention, because there is no precedent.** Nothing in `apps/api` touches the
filesystem for anything but reading committed files; `docs/testing.md` has no rule for it and the
e2e suite has never uploaded a file. Following the same philosophy that forbids mocking Prisma in
integration tests, storage is tested against a real temporary directory, with a
`test/helpers/storage.ts` cleanup helper beside the existing `db.ts`. A memory backend is
rejected: it would be a class that exists only for tests, and this codebase has no such precedent.

**Coverage is a real risk, in the opposite direction from the usual one.** The API's Jest config
has a single global threshold and `collectCoverageFrom: ['**/*.(t|j)s']`, so a new module is
counted automatically and drags the average down. Headroom over the floor is roughly 2.6 to 3.3
points. An under-tested storage module can turn CI red without anyone deleting a test. No new
floor is needed; coverage is.

**Dependencies barely move.** `multer` is already a direct dependency of
`@nestjs/platform-express`, and `file-type` of `@nestjs/common`, so neither is a new install.
`@types/multer` is added as a devDependency — or the file shape is typed structurally the way
`smtp-mail-sender.ts` already types its transporter, for the same reason. `file-type` v21 is
ESM-only and the API compiles to CommonJS, so it is reached with `await import()` and added to
the Jest `transformIgnorePatterns` allowlist.

**Rate limiting is named as insufficient rather than pretended to be enough.** The throttler
counts requests per IP per route. That is the wrong unit twice for uploads: twenty 100 MB
requests and twenty 10 kB requests spend the same budget, and an office behind one NAT shares a
bucket. The real ceiling is `limits.fileSize` plus a per-workspace storage quota. Per-IP tracking
stays as an accepted limitation; overriding `ThrottlerGuard.getTracker` is not attempted here.

**Split-domain deployments preview images through `fetch` and `blob:`, not `<img src>`.** The web
CSP's `img-src 'self'` is not widened by an absolute API URL — `connectSources` adds that origin
to `connect-src` only. The same-origin default is unaffected.

## Alternatives considered

| Alternative                                        | Why not                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store bytes in Postgres as `bytea`                 | Solves backup, retention, cascade and orphans in one move — and destroys the thing it is protecting: dumps grow by the size of every file, and the stated RTO of ≤2 hours does not survive a multi-gigabyte restore |
| Require S3/MinIO from the start                    | Breaks the five-minute Compose install for the majority to serve the minority who already run object storage                                                                                                        |
| Ship disk and S3 together in the first release     | Two code paths and two test matrices for a backend no reported deployment needs yet; the port makes it an added file later                                                                                          |
| Signed URLs for download                           | Cannot move authorization to a proxy the operator is invited to replace, so it buys only the loss of the guard chain, plus a revocation problem the cookie does not have                                            |
| Serve files from the web origin                    | That origin already carries `'unsafe-inline'` in `script-src`; the API's `default-src 'none'` is strictly stronger for attacker-supplied content                                                                    |
| Delete files inline on the delete path             | `Workspace → Board → Task` cascades inside Postgres without calling application code, so the path would miss every bulk delete                                                                                      |
| Sweep orphans with no grace period                 | Deletes every file uploaded after the most recent dump the first night following a restore                                                                                                                          |
| Trust the declared `Content-Type` or the extension | Both are caller-supplied; neither is evidence of anything                                                                                                                                                           |
| A memory storage backend for tests                 | Would exist only for tests, unlike `LogMailSender` which is also a production fallback                                                                                                                              |
| Add an `ATTACHMENTS_ENABLED` flag                  | This codebase reserves `_ENABLED` for default-on kill switches and for consent; a default-off feature that needs a path to work is enabled by that path being set                                                   |
