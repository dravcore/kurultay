# 0024. Attachment Kinds and Serving Policy: FILE or LINK, One Size Number in Two Layers, Inline Only for Images

**Status:** Accepted
**Date:** 2026-08-15
**Updated:** 2026-08-18 — the kind/nullability invariant below is now enforced by a CHECK constraint, `Attachment_kind_fields_check` (`migrations/20260818120000_attachment_kind_check`, guarded by `test/attachment-kind-check.e2e-spec.ts` under ADR 0017's rule): the enum shipped without one, so "a row with both a `url` and a `storageKey`, or with neither" was still writable by anything bypassing `AttachmentService` — the bulk importer this ADR names among them (audit finding DB-02).
**Updated:** 2026-08-18 — the title's "One Size Number in Two Layers" no longer describes the shipped config: `docker/Caddyfile`'s `request_body { max_size 26MiB }` sits deliberately one MiB **above** `ATTACHMENT_MAX_BYTES` (25 MiB), not equal to it. `max_size` counts the whole multipart request body while `ATTACHMENT_MAX_BYTES` counts only the file part, so a file of exactly the published limit cleared the API's check and died at the proxy under the original equal-numbers config — measured on the real request shape and fixed in #216. The invariant the two layers now hold is an ordering, not an equality — **the proxy must never reject something the API would accept** — guarded by `apps/api/src/storage/two-layer-limit.spec.ts` and documented in [self-hosting.md](../self-hosting.md#why-the-proxys-number-is-26-mib-and-the-apis-is-25).
**Updated:** 2026-08-18 — the citations to `audit/phase-3-plan.md` and `audit/ROADMAP.md` by line number are unresolvable to anyone without the gitignored `audit/` tree; each has been rewritten below to carry its load-bearing content inline (quoted where the surrounding text already carried it, paraphrased where it did not) instead of pointing at a file a clone does not have.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0024-attachment-kinds-and-serving-policy.md)

## Context

[ADR 0022](0022-attachment-storage.md) settled where attachment bytes live, who is allowed to read
them, how the backup learns about them and how orphans are swept. It is a storage decision, and it
is complete as one. It is not a complete specification of the feature, and the difference was
measured rather than assumed: an audit of 0022 against the work P3-1 actually has to do found four
questions the document either does not raise or raises without answering.

**First, the record has no notion of an attachment that is not a file.** The words `noopener`,
`noreferrer`, "external link", SSRF and `type` do not appear anywhere in 0022 — zero matches for
each. That silence is not neutral, because a scope decision taken the same week says the opposite.
The phase plan's own scope decision for the Trello importer (§7 decision 4) records that it
carries attachment **URLs**, not bytes: "Dosya taşınmıyor (Trello export vermiyor); URL tipi
attachment kaydı oluşuyor" — no file is moved, an attachment record of the URL kind is created.
The plan then names the debt it just created, in its own words at lines 917-920 —
the decision "adds a sixth decision point to P3-1's ADR: whether an attachment record is a _file_
or a _URL_ has to be represented in the model, because the URL kind has no storage, no size, no
MIME. If that distinction is not known while P3-1 is designed, P3-3 will force it through the
model." ADR 0022 did not carry that load. It is due here.

**Second, the size limit has a mechanism and no number.** 0022's decision reads "The size limit is
set in two layers" and names both layers, multer's `limits.fileSize` and a body-size row in the
published proxy contract. Neither layer is given a value. Its Rationale explains at length why the
proxy contract needs the row at all — nginx defaults `client_max_body_size` to 1 MB while Caddy
sets no limit, so the operator who followed the documentation most carefully gets an untraceable
`413`. That reasoning is correct and unfinished: two layers with two different numbers reproduce
exactly the untraceable 413 the paragraph exists to prevent, only now inside a deployment that
followed the contract.

**Third, the MIME allowlist has a mechanism and no contents.** 0022 decides that validation is "an
allowlist plus content sniffing" with `file-type` reading magic bytes and rejection as a 415. It
never says what is on the list. An allowlist with no membership is an implementer's guess wearing
a decision's clothes.

**Fourth, `Content-Disposition` is never decided.** The string occurs once in the whole document,
inside the paragraph about stream ordering — "If a handler has already written
`Content-Disposition` and started streaming when a disk or database error arrives" — where it is
an example of something a handler might have written, not a policy. Whether a stored PDF renders
in the browser or lands in the downloads folder is unanswered, and it is the question with the
largest security surface of the four.

Beyond those four, 0022 leaves several things to implementation without saying that it is doing
so, which is a smaller problem with the same shape: the reader cannot tell a deliberate deferral
from an oversight. The tenant scope's mechanism (schema column or relation path), the realtime
event, the activity trail and the field list of the `Attachment` model are all in that category.
This ADR names each one and either decides it or says explicitly that it is the implementation
plan's to make.

`docs/decisions/README.md` says a merged ADR "is treated as historical (edit later decisions by
superseding, not by rewriting history)". So none of this is a patch to 0022. **This ADR extends
0022; it does not supersede it.** 0022's storage, authorization, backup and sweep decisions all
stand unchanged, and the index row for 0022 is annotated rather than restated.

## Decision

**An attachment is a `FILE` or a `LINK`, and the schema says which.** `AttachmentKind` is a Prisma
enum with exactly those two values. A `FILE` carries a storage key, a sniffed MIME type and a byte
size. A `LINK` carries a URL and none of those three — no storage key, no size, no MIME, and no
row in the storage backend. The kind is not derived from whether some other column happens to be
null; it is the column that the rest of the model's nullability is derived from.

**`LINK` is a first-class user-facing type, not an import artifact.** P3-1 ships the UI for adding
a link to a card, alongside the UI for uploading a file. P3-3's importer creates `LINK` rows
through the same path a user does, rather than through a private one.

**One size number, `ATTACHMENT_MAX_BYTES`, default 25 MiB (`26214400`), written in both layers.**
The API sets multer's `limits.fileSize` from it, and the published proxy contract gains a body-size
row carrying the same value — `request_body { max_size 25MiB }` in `docker/Caddyfile`, placed
**inside the `handle_path /api/*` block and before its `reverse_proxy` line**, and the
`client_max_body_size 25m;` equivalent in the nginx block of
[self-hosting.md](../self-hosting.md). That placement was run through `caddy validate` on the
image the stack pins (`caddy:2-alpine`, `docker-compose.yml:426`) rather than inferred from the
directive's documentation. The two layers are not independently tunable and are not
documented as if they were: a deployment that raises one without the other is misconfigured, and
the documentation says so where the number appears. This is a value, not a feature flag, so 0022's
`_ENABLED` rule is untouched — `STORAGE_PATH` still decides whether attachments exist at all.

**The MIME allowlist is broad, and `text/html` and `image/svg+xml` are outside it.** Allowed:
`image/png`, `image/jpeg`, `image/gif`, `image/webp`; `application/pdf`; the office documents
(`.docx`, `.xlsx`, `.pptx` and their OpenDocument counterparts); `application/zip`; `text/plain`
and `text/csv`. Excluded, deliberately and by name: `text/html`, `image/svg+xml`, and every
executable or script container. The list is the decision; the exact media-type strings for the
office formats are transcription, and the implementation plan writes them out.

**`Content-Disposition: attachment` is the default; `inline` applies only to the four image
types.** `image/png`, `image/jpeg`, `image/gif` and `image/webp` are served `inline`, because
0022 already decided that "inline preview covers images only" and the task panel's preview needs
it. Everything else — PDFs included — is served `attachment`. Three headers ride on **every**
attachment response regardless of kind or disposition: `X-Content-Type-Options: nosniff`,
`Cross-Origin-Resource-Policy: same-origin` (overriding the `cross-origin` policy the API sets
globally at `apps/api/src/common/configure-app.ts:46`), and a `Content-Type` taken from the
**sniffed** type, never from the client's declared one.

**No new socket event. ADR 0023's call is inherited, not re-made.** An attachment mutation announces
itself as `SocketEvents.TASK_UPDATED` carrying `{ workspaceId, boardId, actorId, taskId }` — the
payload `TaskEventsService.emitUpdated` produces at
`apps/api/src/task/task-events.service.ts:29-38` — and the client re-reads the task over REST.
Which object performs that emit is a module-boundary question, settled below rather than here.
The phase-3 plan (now folded into [ROADMAP.md](../../ROADMAP.md)) assigned this choice to whichever
of P3-1 and P3-2 shipped first and said "attachments and import inherit the same decision"; P3-2
shipped it as [ADR 0023](0023-checklist-data-model.md). This paragraph is the link 0022 never drew.

**Adding and removing an attachment each write an `Activity` row — `attachment.created` and
`attachment.deleted` — but only `attachment.deleted` enters `AUDIT_ACTIVITY_TYPES`.** The two
constants are `AttachmentCreated: 'attachment.created'` and
`AttachmentDeleted: 'attachment.deleted'`, both joining `ActivityType` in
`packages/shared-types/src/activity.ts`; only the second is added to the audit subset at
`activity.ts:65-83`. The strings are fixed here rather than left to the implementation, because
that file's own header states the constraint that makes them one-shot: the names "are written into
the database, so they are a storage format and not display text: renaming one orphans every row
already carrying the old string. Add, never rename" (`activity.ts:11-13`). The verbs are
`created`/`deleted` rather than `added`/`removed` to match the existing `<subject>.<past-tense
verb>` vocabulary — `comment.created` and `task.deleted` are the direct precedents, and no name in
the list uses `added`.

**The phase-3 plan (now folded into [ROADMAP.md](../../ROADMAP.md)) proposed both types for the
audit subset, and that half of the proposal is rejected here.** It read "(Öneri: evet,
ekleme+silme.)" — yes, both add and delete. This ADR takes the delete and declines the add. The
proposal was written before two things
that decide the question: §7 decision 4, which gave P3-3 a bulk import that creates an
attachment record per imported URL, and the volume criterion `activity.ts:51-64` states for the
subset. The narrowing is recorded rather than applied quietly, because a later reader comparing the
plan to the code would otherwise find a silent discrepancy and have to guess which one was
intended.

**The server never fetches a `LINK`'s URL. Not once, for any reason.** No preview, no favicon, no
`<title>` scrape, no metadata, no unfurl, no link-health check. The URL is stored, returned and
rendered by the client; the server treats it as opaque text. Stored URLs are restricted to the
`http:` and `https:` schemes — `javascript:`, `data:` and `file:` are rejected at write time — and
the web client opens them with `target="_blank" rel="noopener noreferrer"`. This is a decision, not
an implementation detail, and it is written here rather than in a code comment because
the phase-3 plan (now folded into [ROADMAP.md](../../ROADMAP.md)) asked of every constraint of this
shape: "where will the person who is about to violate this read it?" Anyone adding link previews
later has to read this paragraph and break it on purpose.

**Tenant scope rides the relation path. There is no denormalized `Attachment.workspaceId`.** The
scope is expressed the way `ChecklistService` expresses it —
`where: { id, taskId, task: { board: { workspaceId } } }`,
`apps/api/src/task/checklist.service.ts:82-84` — and `Task` itself carries no `workspaceId` column
to copy from. The 404-not-403 rule stays where it already is, in the guard layer at
`apps/api/src/common/guards/workspace.guard.ts:34-37`.

**The storage key is derived on the server from the attachment's own id.** `storageKey` is
computed from the row's UUIDv7 and nothing else. The user's filename is stored as a display field
only and never reaches a path segment, so path traversal is not a validation problem that has to be
solved correctly on every code path — it is structurally unavailable.

**A stored display name may not contain a character that makes it render as something else.**
Being "only a display field" is exactly why this rule exists: the name is drawn in the task panel
and in the browser's own save prompt, and both of those are places a user makes a trust decision.
One character class is removed at write time and again when the name is written into
`Content-Disposition` — `"` and `\`, the C0/C1 controls, and the Unicode bidi overrides
(U+200E/U+200F, U+061C, U+202A–U+202E, U+2066–U+2069). The first two groups protect the header;
the third protects the reader, because U+202E reverses the rendering of everything after it and
`invoice<RLO>gnp.exe` is drawn as `invoiceexe.png`. It was measured surviving the whole path
before this rule existed — the RFC 5987 parameter percent-encodes it and the browser decodes it
again, so neither half of the header caught it. **The rule applies to a `LINK`'s label as well as
to an uploaded filename**, which is where it was originally missing: `LINK` labels never reach a
header, but they reach the same panel. Note what is _not_ removed: ordinary non-ASCII text. A rule
that dropped every non-ASCII character would satisfy the same tests and would undo the
`defParamCharset: 'utf8'` decision below, so both halves carry a control test.

**`uploadedById` is a real foreign key to `User`, with `onDelete: Restrict`.** The precedent is
`Comment.user`, which is `Restrict` in the Comment model in `apps/api/prisma/schema.prisma`. The cost is stated
rather than discovered later: this enlarges the surface P3-4 (account deletion and anonymization,
finding DB-05) has to reason about — that finding already describes today's position as one where
"a GDPR/KVKK deletion request cannot be fulfilled even in psql because of `Restrict` FKs". ADR
0023 avoided a `User` FK on checklist items for exactly this reason. This ADR pays the
cost anyway, and the Rationale says why the two cases differ.

**Attachments get their own module, `apps/api/src/attachment/`.** The controller follows the
`CommentController` precedent — `@Controller('workspaces/:workspaceId')` at
`apps/api/src/comment/comment.controller.ts:16` — with the per-route paths 0022 already published.
This is a deviation from the guidance written into `apps/api/src/task/task.module.ts:17-32`, which
ends "New sub-resources should follow the checklist shape"; the deviation is named as one and
argued below rather than left for a reviewer to notice.

**The separate module emits `TASK_UPDATED` itself, and its endpoints return `AttachmentDto`, not
`TaskDto`.** `task.module.ts` deliberately exports only `TaskService` — its comment at lines 17-19
says `TaskReadService` and `TaskEventsService` "are the module's internals", citing
`docs/coding-standards.md` — so an `AttachmentModule` cannot reach `emitUpdated`. The comment
module already solved this: `CommentModule` imports `RealtimeModule` itself
(`apps/api/src/comment/comment.module.ts:9`) and `CommentService` publishes directly through
`this.realtime.emitToBoard(...)` (`apps/api/src/comment/comment.service.ts:141-147`).
`AttachmentModule` does the same, emitting `SocketEvents.TASK_UPDATED` with a payload byte-identical
to `TaskEventsService.emitUpdated`'s — `{ workspaceId, boardId, actorId, taskId }` — so D5 holds
without `task.module.ts`'s encapsulation being reopened. The endpoints then return `AttachmentDto`,
following the same precedent: checklist endpoints return `TaskDto` because their controller _is_
`TaskController`, and that reason does not survive the move to a separate module. The client
re-reads the task over REST when `task:updated` arrives, which is ADR 0023's design, so nothing
depends on the mutation response carrying the whole task.

**Left to the implementation plan, explicitly and not by omission:** the `Attachment` model's full
field list; its index set; `AttachmentDto`'s field list; the query shape of the orphan sweep 0022
already decided to build; and how the web surface splits into components. Each is a shape question
with no cross-cutting consequence, and none of them can be got wrong in a way another ADR would
have to undo.

## Rationale

**Why `kind` is a column and not an inference.** The alternative is cheaper by one enum:
`storageKey`, `mimeType` and `size` all become nullable, `url` becomes nullable, and "is this a
link" is answered by `mimeType === null`. It was rejected because it makes an invariant that the
database could enforce into one that only the application remembers. Nothing stops a row with both
a `url` and a `storageKey`, or with neither, and the first such row is created by an importer
running a bulk insert at three in the morning. The phase plan predicted the exact failure at lines
917-920 — that without a kind, "P3-3 will force it through the model", meaning a size of 0, an
empty MIME and a fake storage path on every imported row. Those three lies then propagate: the
sweep sees a storage path with no file behind it and has to special-case it, the quota sums a 0
that is not a size, and the download endpoint has a branch for a key that never resolves. An enum
costs one migration and deletes all of that.

**Why `LINK` is a user-facing type rather than an import-only one.** A record type that only an
importer can create is a record type nobody tests by using the product. It would ship with an API
shape, a DTO field and a rendering path that the entire P3-1 window never exercises, and P3-3 would
be the first thing to run it — in bulk, against real data, with no UI to inspect what it produced.
Exposing the same path to users makes the import target a surface that has already been used.
It also answers a request the product would otherwise have to answer twice: teams paste links to
design files and documents onto cards far more often than they upload copies of them.

**Why the number has to be the same in both layers.** 0022 established that a silent proxy limit
produces a `413` the operator cannot trace to anything written down. Two documented limits with
different values is that failure with an extra step. If the proxy allows 25 MiB and multer allows
10, a 20 MiB upload dies inside the API with an error the proxy logs as a successful proxied
request; if the proxy allows 10 and multer allows 25, the same upload dies at the edge and the API
never sees it, so nothing in the application logs or in Sentry records that anything happened at
all. Both directions produce a bug report of the form "large uploads sometimes fail" against a
system where every individual component is behaving as configured. One number, named once, quoted
in both places, is the only version of this that stays debuggable.

**Why 25 MiB specifically.** P3-1's success metric, tracked in the audit board that is now folded
into [ROADMAP.md](../../ROADMAP.md), was "10 MB dosya ekleme ≤3 sn" — a 10 MB attachment in under
three seconds. A ceiling of 25 MiB leaves that
measurement comfortably inside the allowed range rather than sitting on its boundary, where a
metric run would be measuring the limit instead of the upload path. It is also large enough for
the documents this feature exists to carry (a slide deck, a scanned contract, a screen recording of
a bug) and small enough that a single upload cannot exhaust a small VPS's disk headroom in one
request, which matters because the deployment target is one machine.

**Why the allowlist is broad but excludes SVG.** A narrow allowlist fails the feature: a tool that
refuses `.xlsx` because a strict reading of "safe types" excluded it is a tool people stop trying
to attach things to, and the audit ranked attachments first among the gaps that end an evaluation.
Breadth is therefore the default. SVG is the one image type held out, and it is held out precisely
because of the decision above it: SVG is markup, it can carry `<script>`, and images are the single
family this ADR serves `inline`. Allowing `image/svg+xml` would not add one more file type — it
would convert the inline-preview decision into a stored cross-site scripting vector on the API
origin, which is the origin 0022 chose for its `default-src 'none'` strength. `text/html` is
excluded for the same reason at a shorter distance; `security-headers.ts` already names it, and
0022's own Rationale quotes that comment. Content sniffing does not rescue either case, because
both files really are what they claim to be.

**Why `inline` for images forces the two headers rather than merely recommending them.** Serving
anything `inline` is an instruction to the browser to render in a document context. `nosniff` is
what keeps that rendering confined to the type the server computed: without it, a browser that
disagrees with the declared type may render a `.png` upload as HTML, and the whole allowlist
becomes advisory. `Cross-Origin-Resource-Policy: same-origin` is what keeps an inline-renderable
resource from being embedded by any other site — the API sets `cross-origin` globally at
`configure-app.ts:46` because the web app is a legitimately separate origin, and that reasoning
does not extend to user-uploaded bytes. 0022 already required the CORP override; what it did not
say is that the `inline` decision is what makes it load-bearing rather than tidy. Serving the
sniffed `Content-Type` rather than the declared one closes the last gap: an allowlist that
validates the sniffed type and then echoes the client's string has validated one value and shipped
another.

**Why the server never touches a `LINK`'s URL.** Any server-side fetch of a user-supplied URL is
an SSRF primitive, and this deployment is the worst possible place to have one: a Compose stack
where `postgres`, `redis` and `api` resolve by name on an internal network the browser cannot
reach. A link preview feature would let any workspace member ask the API to fetch
`http://postgres:5432/`, or a cloud metadata endpoint, and report back what it found. The feature
being requested — showing a title and a favicon next to a URL — is cosmetic; the capability it
requires is not. Restricting the stored schemes to `http:` and `https:` closes the client-side half
of the same problem: a `javascript:` URL rendered into an `href` is stored XSS with a click, and
`rel="noopener noreferrer"` keeps the opened page from reaching back through `window.opener` or
leaking the board URL in a `Referer`.

**Why attachments write activity when checklists do not.** `ChecklistService` imports no
`ActivityService` — the file's imports are Prisma, the position helpers, its DTOs, `TaskReadService`
and `TaskEventsService`, and nothing else — and that was right for checklists. The difference is
recoverability. A checklist item deleted by mistake is a sentence someone retypes; the record of
its deletion would be a row about an event with no lasting consequence. An attachment deleted by
mistake is gone, and 0022's own orphan sweep is what makes it gone — the row disappears from
Postgres, and the nightly sweep removes the bytes from disk once the grace period passes. When a
user removes one attachment from one card, that activity row is the last remaining evidence the
file existed. That asymmetry — a checklist item is retypable, a swept file is not — is why one
feature writes activity and the other does not, and it is also what decides which of the two new
types belongs in the audit subset.

**Why only the delete side is in the audit subset.** `activity.ts:51-64` states what the subset is
for in one sentence — "who removed, granted or destroyed something here?" — and uploading a file is
none of those three. It is content creation, which puts it in `comment.created`'s class, not
`board.created`'s: the board and label events are in the subset because they are structural
administration whose rows are "often the only surviving evidence that the work existed at all"
(`activity.ts:24-25`), and `task.deleted` is in it because, as the same comment says, it is "the
one content event that destroys rather than edits". `attachment.deleted` is a second such event,
and on the path it covers it is the stronger one — a deleted task's rows are still in last night's
dump, while a swept attachment's bytes are on a disk the dump does not cover.

**What `attachment.deleted` does and does not record.** It covers the singular path only: a user
removing one attachment from one card. It does not fire when a workspace, board or task is deleted,
because those cascade inside Postgres — 0022 states it plainly, "one `DELETE FROM \"Workspace\"`
removes thousands of attachment rows inside Postgres with no application code involved" — and no
application code runs to write a row. That is the correct behaviour, not a gap to close. Routing
the cascade through application code to emit per-attachment activity would be an attempt to reverse
the very property 0022 built the orphan sweep around, that "orphan production is bulk and silent";
the answer to bulk deletion is the sweep and its `CleanupCounts`
(`apps/api/src/retention/cleanup.worker.ts:71`), not thousands of audit rows describing one click.
What survives the bulk paths differs by level, and the difference is worth stating exactly. Deleting
a **task** or a **board** leaves the event itself on record — `task.service.ts:233` writes
`ActivityType.TaskDeleted` and `board.service.ts:166` writes `ActivityType.BoardDeleted` — so the
attachments are not enumerated but the deletion that took them is. Deleting a **workspace** leaves
nothing in `Activity` at all: every row cascades with the tenant, taking those `board.deleted` rows
with it, and `workspace.deleted` is deliberately not an `ActivityType` — "that constant is the set
of values written to `Activity.type`, and this event is never written there"
(`apps/api/src/workspace/workspace.service.ts:36-37`). Its only trace is the JSON application-log
line `WorkspaceService.remove` writes. That limit predates this ADR and is argued where it was
made; it is named here only so the sentence above is not read as covering it. So the audit subset
answers "who detached a file from a card", not "which files stopped existing" — and the second
question is answered by `task.deleted`/`board.deleted` plus the sweep's counts at task and board
level, and by the application log alone at workspace level.

The argument for including `attachment.created` ran the other way: an incident responder asking
"what did this compromised account do here" wants what was put there as well as what was taken.
That argument was rejected for two reasons that only appear when the rest of Phase 3 is in view.
First, it would have to rest on uploads being low-volume, which would make an audit-query decision
depend on a rate limit whose value 0022 never set and this ADR deliberately does not set either —
a decision resting on an unwritten number is the exact defect this ADR was opened to fix in 0022.
Second, and decisively, P3-3's importer creates an attachment record per imported URL (§7 decision
4, the same Trello-import scope decision the Context section quotes), so one board import writes
`attachment.created` rows in bulk. That is precisely the
volume behaviour `comment.created` is excluded for, and it would arrive through a code path no rate
limit governs. Keeping the create side out means the importer can write as many rows as it likes
and the incident-response query never sees them. The responder loses nothing they cannot get from
the task's own activity feed, which still records every upload.

**Why the `User` foreign key is worth a cost ADR 0023 refused to pay.** 0023 declined
`completedById` on a checklist item because ticking a box is not an attributed act and the field
would exist only to answer a question nobody had asked. Uploading a file is the other kind of
event: it is authored, in the same sense a comment is, and `Comment.userId` has been a `Restrict`
FK since the beginning. The activity row from the previous decision does hold an actor id, so in
principle the display could join through it — but that makes "who uploaded this" a query against
the audit trail rather than a property of the object, which is both slower and semantically wrong.
The trail records that an upload happened; the attachment record is what the upload produced. The
honest statement of the trade is that P3-4 now has one more `Restrict` FK to design around, and
that this ADR chose a correct model over a cheaper migration for the ADR that comes after it.

**Why a separate module, against the guidance in `task.module.ts`.** That comment's reasoning is
sound and local: checklists went directly on `TaskController` because the alternative was eight
pass-through methods on a 15.8 KB `task.service.ts` that issue #40 already asks to split.
Attachments fail two of that shape's assumptions. First, three of the five endpoints 0022
published are not addressed through a task at all — `GET`, `DELETE` and the content stream all live
at `/workspaces/:workspaceId/attachments/:attachmentId`, which is not a route `TaskController`
should own. Second, the module carries dependencies the task module has no reason to grow: the
storage port, a multer interceptor, an ESM dynamic import of `file-type`, and the only handler in
the API that writes bytes to a response instead of JSON. Putting that inside `task/` grows exactly
the file the existing comment is trying to shrink, which means following the letter of the
guidance would violate its reason. `CommentController` is the precedent for a task sub-resource
that earned its own module, and it is mounted at the same `workspaces/:workspaceId` root.

**`FileTypeValidator` cannot be used, and this is measured, not suspected.** Nest's
`ParseFilePipe` ships a `FileTypeValidator` that does exactly what 0022 asks for — magic-number
inspection via `file-type`. Reading it disqualifies it. At
`node_modules/@nestjs/common/pipes/file/file-type.validator.js:80` it loads the ESM module through
`loadEsm(...)`, and the surrounding `try/catch` at lines 96-111 ends with a bare `return false`
when that load throws. The catch block recognises the failure well enough to log about it — lines
99-105 match `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`, `Cannot find module` and `ERR_MODULE_NOT_FOUND`
and warn "If you are using Jest, run it with `NODE_OPTIONS=\"--experimental-vm-modules\"`" — and
then returns `false` anyway. Under the API's Jest config that means a genuine PNG fails validation
and the caller receives a `415`, indistinguishable from the user having attached the wrong thing.
The failure mode is a misconfiguration wearing a user error's response code, which is the same
class of hazard as 0022's `transformException` paragraph and belongs beside it. The decision is a
thin wrapper of our own around `await import('file-type')`, where a failed import is an error we
raise rather than a validation result we invent.

**Why `file-type` becomes a direct dependency.** 0022 correctly noted that neither `multer` nor
`file-type` is a new install, and that is still true: `pnpm why` resolves `multer@2.2.0` through
`@nestjs/platform-express@11.1.28` and `file-type@21.3.4` through `@nestjs/common@11.1.28`, where
it is pinned exactly (`"file-type": "21.3.4"`, not a range). Exact-pinning is what makes the
transitive dependency safe today and fragile tomorrow: the version is entirely `@nestjs/common`'s
to choose, so a routine Nest patch bump can move a package our own validation path imports by
name, with no entry in our `package.json` to review it against. `file-type` is added to
`apps/api/package.json` at the same version, so a change to it appears in our diff instead of
inside a lockfile hunk nobody reads. `multer` stays transitive — we never import it, we configure
it through `FileInterceptor`.

## Consequences

**P3-1's surface is larger than 0022 described.** The link path is a second create form, a second
DTO branch, a second rendering in the task panel and its own validation. That work was always
coming — §7 decision 4 committed to it — but it was committed to in a plan document rather than in
the ADR, so the estimate attached to 0022 does not include it. Naming it here is the point; the
alternative was discovering it during P3-3.

**`attachment.created` and `attachment.deleted` are permanent from the first row written.**
`activity.ts:11-13` makes the names unrenameable once a row exists, so the review of this ADR is
the last cheap moment to argue about them; after it, a rename is a data migration over rows the
audit query depends on.

**"Who uploaded this file?" is not a one-query answer.** Keeping `attachment.created` out of
`AUDIT_ACTIVITY_TYPES` is what makes the audit subset immune to P3-3's bulk import, and the price
is paid by whoever asks the upload question later: the audit query
(`WHERE workspaceId = $1 AND type = ANY($2)`) will not return uploads, so the answer comes from the
task's own activity feed, one task at a time, or from `Attachment.uploadedById` for a file that
still exists. There is deliberately no workspace-wide "everything uploaded here" query. If an
incident ever needs one, the fix is a query against `Activity` filtered on the single
`attachment.created` type — not a change to the subset, which would reopen the import-volume
problem this decision closed.

**`activity.ts`'s own comments stop being true, and must be rewritten in the same PR.** That file
explains itself positionally: the header (`activity.ts:1-13`) says "the first seven names all
describe something that happened to a card" and "the rest of the list is the audit trail", and the
subset's comment (`activity.ts:51-64`) sorts events into ordinary content versus access-and-
destruction. `attachment.created` fits neither half of either sentence — it is a card event that is
not among the first seven, and it sits beside the audit trail without being in it. Left alone, the
file would document a two-way split its own constant list no longer has. The comments therefore
state the membership rule the split actually rests on, which was always the real criterion and was
never written down: an event joins `AUDIT_ACTIVITY_TYPES` when it is **destructive or
access-changing and low-volume**, not because of where it sits in the list. Writing the criterion
into the file is what lets the next person add a type without re-deriving this ADR — and it is
the only reason the board and label entries can be explained at all, since position never
explained them.

**P3-4 gets harder in a way this ADR chose.** One more `Restrict` FK to `User` is one more relation
an anonymization design has to route around, and finding DB-05 already lists `Restrict` FKs as the
reason a deletion request cannot be executed today. The mitigating fact is that
`Attachment.uploadedById` behaves identically to `Comment.userId`, so it adds volume to that design
rather than a new case.

**The proxy contract is no longer purely about routing.** It has been three `handle` rules and a
promise that an operator may substitute nginx or Traefik. It now also carries a numeric limit that
must agree with a value inside the API, in a document explicitly written for people who will
replace the file it is describing. `docker/Caddyfile` and the nginx block in `self-hosting.md`
both gain the row, both state the number, and both say that changing one alone is a
misconfiguration — plus the Turkish mirror of `self-hosting.md`, in the same PR.

**Something people will ask for is now written down as refused.** Link previews are a feature
users notice the absence of, and D7 forecloses the obvious implementation rather than leaving it
open. A future contributor who wants them has to either accept an SSRF surface deliberately, with
an allowlist and a resolver check argued in a new ADR, or push the fetch to the client where the
API is not the one making the request. The paragraph exists so that choice is made in the open.

**The office formats sniff correctly, and `application/zip` on the list is the safety net for when
they do not.** Every office document is a ZIP container, so the obvious worry is that `file-type`
reports `application/zip` for all of them and D3's office entries never match. Measured against the
pinned `file-type@21.3.4`, that worry is unfounded: a `.docx`, `.xlsx` and `.pptx` each return
their own OOXML media type, and an `.odt` returns
`application/vnd.oasis.opendocument.text`. The detection is not a magic-byte match — `core.js:1320-1343`
reads and parses the archive's `[Content_Types].xml` entry, and `core.js:1306-1318` reads ODF's
stored `mimetype` entry. That is also where the residual risk lives, and it was reproduced rather
than imagined: an archive whose `[Content_Types].xml` is unparseable or too large to read falls
through to a directory-name heuristic that `core.js:727-738` deliberately declines to run in that
case, and the result is a plain `application/zip`. A probe built with a stub `[Content_Types].xml`
did exactly that. `application/zip` being on the allowlist is therefore load-bearing rather than
incidental: an office document from an unusual producer lands on an accepted type instead of a 415
the user cannot act on.

**The attachment module resolves its own tenant scope.** `attachment/` needs the tenant resolution
`ChecklistService` gets from `TaskReadService`, and `task.module.ts` exports neither that nor
`TaskEventsService`. Per D11 the module reaches neither: it resolves the task through Prisma with
the same relation-path `where` and emits through `RealtimeModule` directly, the way `CommentService`
already does. The cost is one more copy of the `task: { board: { workspaceId } }` predicate in the
codebase, which is the price of not widening `task.module.ts`'s exports — and the predicate is the
one piece of this feature most covered by the tenant-isolation e2e tests the audit board (now
folded into [ROADMAP.md](../../ROADMAP.md)) already required.

## Alternatives considered

| Alternative                                                                                                             | Why not                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distinguish a link by leaving `mimeType` null instead of adding `kind`                                                  | Turns a database-enforceable invariant into one only the application remembers; nothing prevents a row with both a URL and a storage key, or with neither, and a bulk importer writes the first one                   |
| A separate `TaskLink` model beside `Attachment`                                                                         | Two models, two endpoint families, two activity vocabularies and two list queries the panel has to merge and order, to represent one thing users already call "the stuff attached to this card"                       |
| Allow `image/svg+xml` on the allowlist                                                                                  | SVG is markup that can carry `<script>`, and images are the one family served `inline` — admitting it converts the inline-preview decision into stored XSS on the API origin                                          |
| Serve everything with `Content-Disposition: attachment`, no inline at all                                               | Removes image preview from the task panel, which 0022 already decided to support; the security gain is available more cheaply through `nosniff`, CORP and the sniffed `Content-Type`                                  |
| Server-side link preview or unfurl (title, favicon, metadata)                                                           | A server-side fetch of a user-supplied URL is an SSRF primitive inside a Compose network where `postgres` and `redis` resolve by name; the feature is cosmetic, the capability is not                                 |
| Use Nest's `FileTypeValidator` with `NODE_OPTIONS=--experimental-vm-modules`                                            | Its own warning text suggests this, but the flag would have to be right in every runner, CI job and IDE; when it is not, the validator returns `false` silently and a valid PNG is rejected as the user's fault       |
| Keep the size limit only at the proxy                                                                                   | Multer's `limits.fileSize` defaults to unlimited, so the API would accept whatever a replaced or misconfigured proxy let through, and the limit would vanish entirely for anyone swapping Caddy out                   |
| Independently tunable API and proxy limits                                                                              | Different numbers reproduce exactly the untraceable `413` that made 0022 add the proxy row: one direction logs a successful proxy request for a failed upload, the other logs nothing at all                          |
| A denormalized `Attachment.workspaceId` column                                                                          | `Task` does not carry one either; the relation path is the shape every task sub-resource already uses, and a copied tenant id is a second source of truth that can disagree with the first                            |
| Build the storage path from the uploaded filename                                                                       | Makes path traversal a validation problem that has to be solved on every write path forever, instead of one that cannot be expressed because the key comes from the row's own UUIDv7                                  |
| No `uploadedById`; read the uploader from the activity trail                                                            | Makes "who uploaded this" a query against the audit log rather than a property of the object — the trail records that an event happened, the row is what the event produced                                           |
| Name the activity types `attachment.added` / `attachment.removed`                                                       | No name in `ActivityType` uses `added`; `comment.created` and `task.deleted` are the precedents, and the names are unrenameable once written, so matching the existing vocabulary is a one-time free choice           |
| `attachment.created` in the audit subset, as the phase-3 plan (now folded into [ROADMAP.md](../../ROADMAP.md)) proposed | Uploading is content creation, not the "removed, granted or destroyed" the subset collects; and P3-3's importer writes one row per imported URL, which is the bulk-volume behaviour `comment.created` is excluded for |
| Export `TaskEventsService` from `task.module.ts` so the new module can emit                                             | Widens an encapsulation `task.module.ts:17-19` states deliberately, to avoid one `emitToBoard` call the comment module already makes directly with the same payload                                                   |
| Return `TaskDto` from the attachment endpoints, as checklist endpoints do                                               | Checklist returns `TaskDto` because its controller _is_ `TaskController`; in a separate module that reason is gone, and the client re-reads the task on `task:updated` anyway                                         |
| No activity rows for attachments, following the checklist precedent                                                     | A deleted checklist item can be retyped; a deleted file is removed from disk by the orphan sweep and the activity row becomes the only evidence it existed                                                            |
| A new `attachment:added` / `attachment:removed` socket event                                                            | ADR 0023 already decided this for both features and the phase plan assigned the decision to whichever shipped first; re-deciding it would fork the realtime contract for no new requirement                           |
| Mount the endpoints on `TaskController` per the checklist shape                                                         | Three of the five published endpoints are not addressed through a task, and the module carries a storage port, a multer interceptor and the API's only byte-streaming handler                                         |
| Leave `file-type` as a transitive dependency of `@nestjs/common`                                                        | It is exact-pinned there, so its version is Nest's to change; a routine patch bump could move a package our validation path imports by name with nothing in our `package.json` to review it against                   |
