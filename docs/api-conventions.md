# API Conventions

REST conventions for the Kurul API: URLs, verbs, payloads, errors, pagination, and DTOs.

> 🌐 English (canonical) | [Türkçe](tr/api-conventions.md)

## Contents

- [Scope](#scope)
- [Resource naming](#resource-naming)
- [HTTP verbs and status codes](#http-verbs-and-status-codes)
- [Request and response bodies](#request-and-response-bodies)
- [Errors](#errors)
- [Cross-origin requests](#cross-origin-requests)
- [Rate limiting](#rate-limiting)
- [Pagination](#pagination)
- [Filtering, sorting, field selection](#filtering-sorting-field-selection)
- [DTO naming](#dto-naming)
- [Data types](#data-types)
- [The OpenAPI document](#the-openapi-document)
- [Versioning](#versioning)

## Scope

These rules apply to every HTTP endpoint in `apps/api`. Socket.io events follow their own
contract, defined in `@kurul/shared-types` and described in
[architecture.md](architecture.md).

Base URL in development: `http://localhost:4000`.

## Resource naming

| Rule                                               |                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nouns, not verbs                                   | `/tasks`, never `/getTasks`                                                                                                                                                                                                                                 |
| Plural collections                                 | `/boards`, `/tasks`, `/workspaces`                                                                                                                                                                                                                          |
| kebab-case in paths                                | `/workspace-members`, not `/workspaceMembers`                                                                                                                                                                                                               |
| camelCase path params                              | `:workspaceId`, `:boardId`, `:taskId`                                                                                                                                                                                                                       |
| Nesting expresses ownership                        | A collection is reached through its owner: a board's tasks, a task's comments                                                                                                                                                                               |
| Nesting stops at 2 levels below the workspace root | `:workspaceId` is mandatory on every route and does not count toward the limit — it is the tenant scope, not a hierarchy level. Deeper hierarchies use query filters instead                                                                                |
| Once a resource has an id, address it shallowly    | `/workspaces/:workspaceId/tasks/:taskId`, never `/workspaces/:workspaceId/boards/:boardId/tasks/:taskId`. The id already identifies the row; the workspace guard already scopes it. The parent segment adds a value the server must validate for no benefit |

### Workspace scoping

**Every resource-bearing route is nested under a workspace.** This is not decoration — it is
how multi-tenant isolation is enforced at the guard level, before any service code runs. A
route without `:workspaceId` cannot be scoped by a guard and is therefore not allowed,
except for the account-level routes listed below.

```
GET    /workspaces
POST   /workspaces
GET    /workspaces/:workspaceId
PATCH  /workspaces/:workspaceId
DELETE /workspaces/:workspaceId

GET    /workspaces/:workspaceId/members        # cursor page of the roster
GET    /workspaces/:workspaceId/members/me     # the caller's own membership
POST   /workspaces/:workspaceId/members/me/leave      # leave the workspace (any role)
DELETE /workspaces/:workspaceId/members/:userId       # remove a member (OWNER/ADMIN)
PATCH  /workspaces/:workspaceId/members/:userId/role  # change a member's role (OWNER/ADMIN)
GET    /workspaces/:workspaceId/invitations     # cursor page of pending invitations (OWNER/ADMIN)
POST   /workspaces/:workspaceId/invitations
DELETE /workspaces/:workspaceId/invitations/:invitationId

GET    /workspaces/:workspaceId/boards
POST   /workspaces/:workspaceId/boards
GET    /workspaces/:workspaceId/boards/:boardId
PATCH  /workspaces/:workspaceId/boards/:boardId
DELETE /workspaces/:workspaceId/boards/:boardId

GET    /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns/defaults  # seed an empty board
PATCH  /workspaces/:workspaceId/columns/:columnId
DELETE /workspaces/:workspaceId/columns/:columnId
PATCH  /workspaces/:workspaceId/columns/:columnId/position

GET    /workspaces/:workspaceId/boards/:boardId/tasks     # list, scoped to a board
POST   /workspaces/:workspaceId/boards/:boardId/tasks     # create in a board

GET    /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId
DELETE /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId/position

GET    /workspaces/:workspaceId/boards/:boardId/labels
POST   /workspaces/:workspaceId/boards/:boardId/labels
PATCH  /workspaces/:workspaceId/labels/:labelId
DELETE /workspaces/:workspaceId/labels/:labelId

POST   /workspaces/:workspaceId/tasks/:taskId/assignees
DELETE /workspaces/:workspaceId/tasks/:taskId/assignees/:userId
POST   /workspaces/:workspaceId/tasks/:taskId/labels
DELETE /workspaces/:workspaceId/tasks/:taskId/labels/:labelId

GET    /workspaces/:workspaceId/tasks/:taskId/comments
POST   /workspaces/:workspaceId/tasks/:taskId/comments
DELETE /workspaces/:workspaceId/comments/:commentId

POST   /workspaces/:workspaceId/tasks/:taskId/checklists
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/position
DELETE /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId
POST   /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/items
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId
PATCH  /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId/position
DELETE /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId  # no GET: checklists come back inside GET tasks/:taskId

GET    /workspaces/:workspaceId/tasks/:taskId/attachments
POST   /workspaces/:workspaceId/tasks/:taskId/attachments   # multipart (a file) or JSON (a link)
GET    /workspaces/:workspaceId/attachments/:attachmentId
GET    /workspaces/:workspaceId/attachments/:attachmentId/content  # the bytes — the one non-JSON response
DELETE /workspaces/:workspaceId/attachments/:attachmentId

GET    /workspaces/:workspaceId/activities                 # workspace activity feed
GET    /workspaces/:workspaceId/tasks/:taskId/activities    # task activity feed

GET    /workspaces/:workspaceId/dashboard/summary

GET    /workspaces/:workspaceId/notifications
GET    /workspaces/:workspaceId/notifications/unread-count
POST   /workspaces/:workspaceId/notifications/read-all
POST   /workspaces/:workspaceId/notifications/:notificationId/read

POST   /workspaces/:workspaceId/imports/trello   # multipart, one part named `file`; admin-only
```

Board and column role gates:
[ADR 0009](decisions/0009-board-column-permissions.md). Task gates:
[ADR 0010](decisions/0010-task-permissions.md). Label and metadata gates:
[ADR 0011](decisions/0011-label-task-metadata-permissions.md). Comment delete authorship:
[ADR 0012](decisions/0012-comment-delete-authorship.md). Activity, dashboard, and notification
routes are read-only aggregations/feeds over the same data and inherit the workspace member
gate (`WorkspaceGuard`) — no separate role matrix.

Attachments are five routes, and three of them are addressed by attachment id rather than
through a task — the shallow-addressing rule above. Reading (list, single, bytes) is open to
any workspace member; attaching and detaching need a content role. Detaching draws **no**
author line, unlike comment deletion (ADR 0012): the same role can already delete the whole
task, and `Attachment.taskId` cascades, so gating the smaller act while leaving the larger one
open would be a UI trap rather than an authorization check. Kinds, limits and the serving
policy: [ADR 0024](decisions/0024-attachment-kinds-and-serving-policy.md).

`imports/trello` is the one route whose collection segment is not a resource anyone can read:
there is no `GET /imports` and no import id, because an import is an action that leaves a board
behind rather than a row of its own. It is admin-only and it is the API's only bulk write — the
shape, the limits and everything it deliberately does not carry across are in
[Importing a Trello board export](#importing-a-trello-board-export).

Invitations are workspace-scoped in the public API. Persistence is the
`WorkspaceInvitation` table, mapped from Better Auth's organization plugin.
Product names map organization → Workspace — see
[ADR 0004](decisions/0004-auth-better-auth.md#domain-mapping-organization--workspace).

Note the shape: a **collection** is nested under the parent that owns it, because that is
what scopes the list. A **single resource** is addressed by its own id directly under the
workspace, because nothing further is needed to find it.

Non-workspace routes (the complete list):

```
GET   /health                # liveness, unauthenticated
GET   /health/ready          # readiness, unauthenticated
GET   /config                # instance capabilities; any signed-in caller
POST  /auth/*                # Better Auth handlers
GET   /me                    # current user profile
PATCH /me                    # own profile; interface language and the notification-email switch
GET   /me/deletion-preview   # what deleting this account would do
DELETE /me                   # delete this account (anonymises it)
GET   /instance/activation                     # activation funnel; INSTANCE_ADMIN_EMAILS only (verified email required)
GET   /instance/users/:userId/deletion-preview # same preview, for an operator
DELETE /instance/users/:userId                 # execute an erasure request for somebody else
```

The two health routes answer different questions and are not interchangeable. `/health` is
liveness — the process is up — and touches nothing, so a dependency blip never gets an
instance restarted. `/health/ready` probes Postgres and Redis and answers `200` with
`{ status, checks }` when the instance can serve traffic, `503` with the same document when it
cannot; `checks` names the dependency that is down (`up` / `down` / `skipped`, the last one
meaning the deployment does not configure it). The failure body is intentionally the probe
document rather than the error envelope below — the caller is a healthcheck, not a client.

`PATCH /me` is not workspace-scoped and not role-gated: the subject is the caller, so the
session guard is the whole authorization story. It is also the only place `User.locale` is
written — see [decisions/0018-localization-strategy.md](decisions/0018-localization-strategy.md) —
and the only place `User.emailNotifications` is: one boolean, `true` for a new account, that
switches the assignment, mention and due-soon emails off together. In-app notifications are
not affected, and the flag changes nothing on an instance whose `mailEnabled` is `false`.

`DELETE /me` deletes the caller's account, and it is the one route in this API that refuses to
act on an incomplete request rather than picking a default. The body carries `confirmEmail` (the
account's own address) and one `disposition` per workspace the caller is the **only** OWNER of —
`transfer` to a named member, or `delete` the workspace outright. A missing, unknown or
duplicated disposition is `409` and names the workspaces still undecided; a confirmation address
that does not match is `403`; a transfer target who is not in that workspace is `404`, the same
opacity every workspace route gives. `GET /me/deletion-preview` is what a client reads to build
that body. `DELETE /instance/users/:userId` is the same operation performed by an instance
operator — `403` when `INSTANCE_ADMIN_EMAILS` does not name the caller or their email is unverified, which is the default on
a fresh install. The account row is anonymised rather than deleted; see
[decisions/0026-account-deletion-anonymisation.md](decisions/0026-account-deletion-anonymisation.md).

The `/instance/*` routes are the only ones in the API that are neither workspace-scoped nor
about the caller themselves. They answer `403` and never `404`: the `404` a workspace route
gives exists to stop a cross-tenant probe distinguishing "forbidden" from "does not exist", and
here there is nothing to hide — the route is in the source of an AGPL project.

### Instance configuration

`GET /config` answers **"what is this deployment configured to do"** with an `InstanceConfigDto`:

```json
{ "mailEnabled": true, "attachmentsEnabled": true }
```

| Field                | Meaning                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mailEnabled`        | `false` when no SMTP host is configured, so every message is written to the API log and delivered nowhere — nobody can confirm an address or accept an invite, and notification email is off whatever `User.emailNotifications` says |
| `attachmentsEnabled` | `false` when `STORAGE_PATH` is unset, so this deployment stores no files and the web app hides the upload control. **Link attachments do not depend on it** — a link needs no storage at all                                         |

Three rules hold this endpoint's shape, and each one is a decision that was available to make
differently:

- **It is not part of `/health`.** A healthcheck exists so an orchestrator can decide whether
  to restart the process, and "SMTP is unconfigured" is never a reason to restart anything —
  it is a permanent, intentional property of the deployment. `/health` is also `@Public()` and
  `@SkipRateLimit()`, an exemption that is only affordable because the document says nothing
  about the product; publishing configuration there would inherit both by accident.
- **It requires a session, and no role.** The leak is small, but nothing needs the endpoint to
  be public, and an unauthenticated one would hand a scanner a per-instance list of what a
  self-hosted install has left unconfigured. Nothing here varies by workspace or by role, so it
  carries no `:workspaceId` and no role gate. Rate limiting is the global default.
- **Every field is a capability, never tenant state.** A value that differs per workspace, per
  user, or per request belongs on the resource it describes. This document must stay cacheable
  as "what this server can do".

### Reporting what happened to an email

`InvitationDto.emailDelivery` is **optional**, carries `SENT` / `NOT_CONFIGURED` / `FAILED`
(`MailDeliveryStatus`), and appears on exactly one response: `POST /workspaces/:workspaceId/invitations`.

**An absent field is not `SENT`.** It means this API observed no send for the request, and a
client must not resolve that into a verdict. A listed invitation is a stored row while delivery
is an event that nothing records, so `GET .../invitations` never carries the field.

The reason it exists at all: the invitation email is sent inside Better Auth's
`sendInvitationEmail` hook, and a failed or log-only send is swallowed there by design (a
stored invitation must not be reported as failed because its notification bounced). That left
the admin with a `201` and no way to learn that nothing was delivered. The status is the
return channel — the request still succeeds, the invitation is still created, and the response
simply says what became of the email. Sending it is still not a precondition of anything: on a
deployment without SMTP the accept link in `acceptUrl` is the one path that works, which is
what the web client offers when the status is not `SENT`.

The same rule applies to any future endpoint that triggers mail: **report the delivery status,
never fail the request on it, and never infer one you did not observe.**

### Actions that are not CRUD

Some operations are not a resource update — moving a task recomputes ordering, an invitation
is accepted rather than edited. Model these as a **sub-resource with a verb-free name** where
possible, and as an explicit action segment where not:

```
PATCH /workspaces/:workspaceId/columns/:columnId/position
PATCH /workspaces/:workspaceId/tasks/:taskId/position
POST  /workspaces/:workspaceId/invitations/:invitationId/accept
POST  /workspaces/:workspaceId/tasks/:taskId/assignees
DELETE /workspaces/:workspaceId/tasks/:taskId/assignees/:userId
POST  /workspaces/:workspaceId/tasks/:taskId/labels
DELETE /workspaces/:workspaceId/tasks/:taskId/labels/:labelId
```

Action segments are the exception and each one needs a reason. Do not invent
`/tasks/:id/doUpdate`.

## HTTP verbs and status codes

| Verb     | Semantics                                    | Idempotent | Body | Success                        |
| -------- | -------------------------------------------- | ---------- | ---- | ------------------------------ |
| `GET`    | Read a resource or collection                | Yes        | No   | `200`                          |
| `POST`   | Create, or trigger a non-idempotent action   | No         | Yes  | `201` (create), `200` (action) |
| `PATCH`  | Partial update — only the sent fields change | No         | Yes  | `200`                          |
| `PUT`    | Full replacement                             | Yes        | Yes  | `200`                          |
| `DELETE` | Remove                                       | Yes        | No   | `204`                          |

**`PATCH` is the default for updates.** `PUT` is used only where a full replacement is
genuinely the operation (reordering an entire column, for example). A `PATCH` that omits a
field leaves it untouched; sending `null` explicitly clears a nullable field.

| Status                       | When                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200 OK`                     | Successful read, update, or action                                                                                                                                                                                                                                   |
| `201 Created`                | Resource created; body is the created resource                                                                                                                                                                                                                       |
| `204 No Content`             | Successful delete; empty body                                                                                                                                                                                                                                        |
| `400 Bad Request`            | Malformed request or validation failure                                                                                                                                                                                                                              |
| `401 Unauthorized`           | Missing or invalid session                                                                                                                                                                                                                                           |
| `403 Forbidden`              | Authenticated, workspace member, but role is insufficient                                                                                                                                                                                                            |
| `404 Not Found`              | Resource does not exist **or** belongs to another workspace                                                                                                                                                                                                          |
| `409 Conflict`               | Uniqueness violation (duplicate slug), or a conflicting concurrent change                                                                                                                                                                                            |
| `413 Payload Too Large`      | A JSON/form body is over `REQUEST_BODY_MAX_BYTES`, an upload is over `ATTACHMENT_MAX_BYTES` or would exceed a storage quota (its `error` says which — see [File uploads and downloads](#file-uploads-and-downloads)), or an import is over `TRELLO_IMPORT_MAX_BYTES` |
| `415 Unsupported Media Type` | The file's **magic bytes** are not on the allowlist. The declared `Content-Type` and the extension are not evidence and are not consulted                                                                                                                            |
| `422 Unprocessable Entity`   | Semantically invalid though well-formed (e.g. moving a task to a column on another board)                                                                                                                                                                            |
| `429 Too Many Requests`      | Rate limited: over a route's request budget, or over the upload route's per-IP byte budget (its `error` says which, see [Rate limiting](#rate-limiting))                                                                                                             |
| `500 Internal Server Error`  | Unhandled failure. Never leaks a stack trace.                                                                                                                                                                                                                        |

**Cross-workspace access returns `404`, not `403`.** A `403` would confirm that the resource
exists, which leaks information across the tenant boundary. `403` is reserved for a
legitimate member whose role is too low.

## Request and response bodies

Resources are returned as **plain JSON objects**. There is no `data` wrapper, no `success`
flag, no envelope.

```jsonc
// GET /workspaces/w_1/tasks/t_1  → 200
{
  "id": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
  "columnId": "0198e2c0-c2d3-7a15-b6e7-8f90a1b2c3d4",
  "title": "Implement fractional indexing",
  "description": "Positions must survive concurrent moves.",
  "priority": "HIGH",
  "position": 1024.5,
  "dueDate": "2026-09-01T00:00:00.000Z",
  "estimatedMinutes": 240,
  "assignees": [{ "userId": "usr_1", "name": "Doğan", "avatarUrl": null }],
  "labels": [
    {
      "id": "lbl_1",
      "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
      "name": "backend",
      "color": "slot-1",
    },
  ],
  "createdById": "usr_1",
  "createdAt": "2026-08-08T09:12:31.114Z",
  "updatedAt": "2026-08-08T09:12:31.114Z",
}
```

Collections are the only exception: paginated lists carry their cursor metadata alongside
the items (see [Pagination](#pagination)).

Rules:

- JSON property names are `camelCase`.
- Omit nothing for the sake of size — a field that exists is always present, with `null` if
  empty. Clients should not have to distinguish "absent" from "null".
- Never return a Prisma entity directly. The response DTO decides what is public.
- `Content-Type: application/json; charset=utf-8` on every response with a body — with exactly
  one documented exception: `GET /workspaces/:workspaceId/attachments/:attachmentId/content`
  answers with the stored file's own media type and its bytes. It is the only handler in the
  API that writes something other than JSON, and the next one needs a reason of the same size.

### Request body size

**`REQUEST_BODY_MAX_BYTES` (default `1048576` — 1 MiB) is the largest JSON or form-encoded body
the API will read.** Over it, the answer is `413` in the error envelope above — a client error,
and one that is deliberately **not** reported to error tracking, exactly like a `404` or a `403`.

This is the size of a _parsed body_ and it is unrelated to `ATTACHMENT_MAX_BYTES`: an upload is
`multipart/form-data`, which this limit never sees — multer reads those, with its own ceiling
(see [File uploads and downloads](#file-uploads-and-downloads)).

Two things about the number are worth stating plainly. It was, until it was written down, an
accident: nothing configured a limit, so Express's own default of **100 kB** was the API's real
ceiling — a value nobody chose and no file recorded. And it is a **memory** ceiling as much as a
size one, since the body is parsed into heap before anything validates it; N concurrent requests
cost up to N × this value. 1 MiB is roughly two orders of magnitude above the largest body any
endpoint legitimately receives today (no endpoint takes an array body, and the longest single
field any DTO accepts is 2048 characters). An endpoint that genuinely needs more does **not** raise
this variable — the Trello importer is the one that would have had to, and instead takes its body
as `multipart/form-data` under a ceiling of its own (see
[Importing a Trello board export](#importing-a-trello-board-export)). Raising this number to fit
one endpoint hands the same memory cost to every other one.

### File uploads and downloads

One endpoint takes both shapes an attachment can have:
`POST /workspaces/:workspaceId/tasks/:taskId/attachments` accepts `multipart/form-data` with a
part named `file` (a **FILE**), or `application/json` (a **LINK**). `kind` is always carried
explicitly in the body — `"FILE"` or `"LINK"` — and never inferred from whether a file part
arrived, so a request carrying neither gets a validation error that names what is missing
rather than a guess. Both shapes answer `201` with an `AttachmentDto`.

**A LINK is a URL the server stores and returns and never requests.** No preview, no favicon,
no `<title>` scrape, no unfurl, no health check. Only `http:` and `https:` are stored;
`javascript:`, `data:` and `file:` are rejected with `400` at write time. Server-side fetching
of a user-supplied URL is an SSRF primitive, and a Compose network where `postgres` and `redis`
resolve by name is the worst possible place for one ([ADR 0024](decisions/0024-attachment-kinds-and-serving-policy.md)).

**A FILE is accepted on its magic bytes.** The declared `Content-Type` and the filename
extension both come from the caller and neither is evidence, so the type is read from the
content and matched against an allowlist: PNG, JPEG, GIF and WebP; PDF; the OpenXML and
OpenDocument office formats; ZIP; plus `text/plain` and `text/csv` through the narrow path
below. `text/html` and `image/svg+xml` are excluded by name, along with every executable and
script container. Anything else is `415`.

**Why a `.txt` is accepted and an `.html` renamed `.txt` is not.** Plain text has no magic
number, so it sniffs as nothing and would be refused by the rule above — which would make its
place on the allowlist a lie. It is instead accepted by a fallback that requires **four**
things at once:

1. the declared type is **exactly** `text/plain` or `text/csv` (nothing else opens this door),
2. the bytes decode as valid UTF-8,
3. they contain no `NUL` byte, and
4. the first non-whitespace character is not `<`.

Fail any one and the answer is `415`. Condition 4 is what keeps markup out, and condition 1 is
a membership test against two literals — the type written to the row and later to the response
header is one of those two literals, never a copy of the caller's string. The declaration
picks between two labels that are already equally inert; it never decides whether the upload is
safe. That verdict is conditions 2-4.

**Size is limited in two layers that carry deliberately different numbers.**
`ATTACHMENT_MAX_BYTES` (default `26214400` — 25 MiB) is the size of the **file** and the number
to quote to users; the reverse proxy caps the **whole request body** and is set higher, because
a multipart envelope adds a few hundred bytes on top of the file. Both answer `413`, and the
response body is what tells them apart: the API's `413` is the error envelope above, the
proxy's is not JSON at all. Which number to change, and the ordering rule between them, are in
[self-hosting.md](self-hosting.md#bringing-your-own-reverse-proxy).

**Storage quotas answer `413` too, with their own `error`.** `ATTACHMENT_WORKSPACE_QUOTA_BYTES`
and `ATTACHMENT_INSTANCE_QUOTA_BYTES` cap the summed size of stored FILE attachments; unset they
are 2 GiB and 20 GiB, and a written `0` lifts one
([ADR 0027](decisions/0027-attachment-quotas.md), updated 2026-08-21). An upload whose bytes
would push the sum past a ceiling is rejected before anything is written. The envelope carries `error: "Attachment Quota Exceeded"` where the per-file limit's
carries `"Payload Too Large"` — the status alone cannot say whether to shrink the file or free
up space, and clients branch on `statusCode` and `error`, never on `message` (see
[Errors](#errors)). A file that fills the quota exactly is accepted; the ceiling is inclusive,
like the per-file one. LINK attachments store no bytes: they neither count against a quota nor
are refused by a full one.

**Downloads.** `GET .../attachments/:attachmentId/content` streams the bytes with the **sniffed**
media type (never the one the client declared at upload), `Content-Length`, and
`Content-Disposition`. Disposition is `attachment` for everything except the four image types,
which are served `inline` so the panel can preview them — PDFs included in "everything". Every
such response also carries `X-Content-Type-Options: nosniff`,
`Cross-Origin-Resource-Policy: same-origin` (overriding the `cross-origin` policy the API sets
globally) and `Cache-Control: private, max-age=0, must-revalidate`. Asking for the content of a
`LINK` is `404`: there are no bytes, and saying "wrong kind" would confirm the row exists.

### Importing a Trello board export

`POST /workspaces/:workspaceId/imports/trello` takes a Trello board's JSON export and creates a
**new board** from it. It is the API's only bulk-write endpoint.

| Property     | Value                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Body         | `multipart/form-data`, one part named **`file`** — no other part, no JSON shape |
| Role         | **`ADMIN_ROLES`** (`OWNER`, `ADMIN`)                                            |
| Size ceiling | `TRELLO_IMPORT_MAX_BYTES` (default `20971520` — 20 MiB)                         |
| Rate limit   | **3 / min** per client IP                                                       |
| Success      | `201` with a `TrelloImportReportDto`                                            |

**Multipart rather than JSON, and that is a decision rather than a convenience.** A board export
is several megabytes and `REQUEST_BODY_MAX_BYTES` is 1 MiB; raising that to fit this one endpoint
would hand the same cost to every other endpoint the API has. So the export arrives as a file
part under a limit this module owns. The two numbers measure different resources —
`TRELLO_IMPORT_MAX_BYTES` is a **heap** ceiling (the bytes are buffered, `JSON.parse`d, and the
parsed graph is a multiple of the bytes that produced it), while `ATTACHMENT_MAX_BYTES` is a
**disk** ceiling — which is why they are separate variables and why neither is derived from the
other. The import limit must stay below the reverse proxy's body limit; that relationship is
covered by a test (`storage/two-layer-limit.spec.ts`) and explained in
[self-hosting.md](self-hosting.md#bringing-your-own-reverse-proxy).

**`ADMIN_ROLES`, by permission arithmetic.** Creating a board is `CONTENT_ROLES`, but creating a
_column_ is admin-only — and an import creates both. An endpoint must not do in one request what
its caller could not do in several.

**Errors:**

| Status | When                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------- |
| `400`  | No part named `file`; the file is not valid JSON; the JSON is not a Trello board export              |
| `403`  | Workspace member whose role is below `ADMIN`                                                         |
| `404`  | Not a member of the workspace, or the workspace does not exist — never `403`, which would confirm it |
| `413`  | The file part is over `TRELLO_IMPORT_MAX_BYTES`                                                      |
| `429`  | More than three imports in a rolling minute                                                          |

A `400` is the only failure that reaches the parser, and **nothing is written when it does**: the
export is read and mapped entirely before the transaction opens, so a rejected import leaves the
workspace byte-for-byte as it was.

**The response body is the whole report, and it is not stored anywhere.**

```jsonc
// POST /workspaces/w_1/imports/trello  → 201
{
  "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
  "boardName": "Product Roadmap",
  "imported": {
    "columns": 4,
    "tasks": 137,
    "labels": 6,
    "checklists": 21,
    "checklistItems": 88,
    "attachments": 12,
  },
  "skipped": [
    { "scope": "column", "reason": "defaulted", "count": 4, "samples": ["Backlog", "Doing"] },
    { "scope": "member", "reason": "unmappable", "count": 9, "samples": ["ayse", "bora"] },
    { "scope": "comment", "reason": "outOfScope", "count": 412, "samples": [] },
    { "scope": "card", "reason": "archived", "count": 57, "samples": ["Old spike"] },
  ],
}
```

`imported` counts rows actually written. `skipped` groups everything else by `(scope, reason)`;
`count` is always the real number, while `samples` is capped at 20 names so the response scales
with the number of _kinds_ of problem rather than with the size of the export. The vocabularies
are closed — `TrelloImportScope` and `TrelloImportSkipReason` in `@kurul/shared-types` — because
the web renders one translated sentence per reason and a free-text reason would ship English into
a Turkish UI (ADR 0018).

**`defaulted` is in the skip list without being a skip**, and deliberately: an imported column
takes the default category and an unknown Trello colour falls back to `slot-1`. Both changed
something the user will see, and the question after an import is "why does my board look
different", not "what did I lose".

**What this endpoint does not do**, each of which is a decision recorded in
[ADR 0025](decisions/0025-trello-import-mapping.md):

- **No idempotency.** Posting the same export twice creates **two boards**. There is no dedupe
  key, no update-in-place, no "already imported" answer. Updating an existing board is
  synchronisation, not import, and it needs a conflict policy this API does not have.
- **No member mapping.** A Trello account is not a Kurul account, so assignments are dropped
  and counted. Every row written — tasks and attachments alike — is attributed to the caller.
- **No column categories.** Every imported column is `UNSTARTED`; the category is never inferred
  from a list's name or its position ([ADR 0019](decisions/0019-column-category.md) refuses both).
  The report says how many columns this affected, and the user sets them afterwards.
- **No files.** A Trello export carries attachment URLs, not bytes, so every attachment becomes a
  `LINK` row — and the server never requests those URLs, the same rule the attachment endpoint
  follows.
- **No comments.** Out of scope, and counted rather than silently dropped.
- **No socket event.** An import creates a board whose room nobody has joined yet. It writes
  exactly one activity row, `board.imported`, rather than one per card.

## Errors

Errors use a **problem-JSON-style object** (RFC 7807 in spirit, using NestJS's field names so
the framework's built-in exceptions and hand-written ones look identical):

```jsonc
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "title", "constraint": "isNotEmpty", "message": "title should not be empty" },
    {
      "field": "estimatedMinutes",
      "constraint": "min",
      "message": "estimatedMinutes must not be less than 0",
    },
  ],
  "path": "/workspaces/w_1/boards/b_1/tasks",
  "timestamp": "2026-08-08T09:12:31.114Z",
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
}
```

| Field        | Type   | Required | Meaning                                                             |
| ------------ | ------ | -------- | ------------------------------------------------------------------- |
| `statusCode` | number | yes      | Mirrors the HTTP status                                             |
| `error`      | string | yes      | Stable, machine-readable reason phrase (`Bad Request`, `Not Found`) |
| `message`    | string | yes      | Human-readable, single sentence, safe to log                        |
| `details`    | array  | no       | Per-field validation problems; present only for `400`/`422`         |
| `path`       | string | yes      | Request path                                                        |
| `timestamp`  | string | yes      | ISO 8601 UTC                                                        |
| `requestId`  | string | yes      | Correlation id; same value as the `X-Request-Id` response header    |

- One global exception filter produces this shape for **every** error, including unhandled
  ones. There is no second error format anywhere in the API.
- `message` is never a raw exception string in production, and stack traces are logged, not
  returned.
- Clients branch on `statusCode` and `error`, never on `message` text.
- A failure thrown by a library whose error vocabulary _is_ HTTP status codes — `http-errors`,
  which is what Express's body parsers throw — is answered with **its own 4xx** in this envelope,
  with wording chosen here rather than the library's. The mapping stops at 4xx on purpose: a 5xx
  from the same source is still a server fault and keeps the `500` envelope _and_ the report.

### Request correlation

Every request carries an id, and every response returns it in the `X-Request-Id` header. A
client may supply its own — an id minted by a reverse proxy or load balancer flows straight
through — as long as it is URL-safe and between 8 and 128 characters; anything else is
discarded and replaced with a generated [UUIDv7](#data-types), so a header value can never
reach a log line or a response body unsanitised.

The same id appears in three places, which is the point: the `X-Request-Id` header the client
received, the `requestId` field of the error envelope, and the server's log lines for that
request. A user reporting a failure quotes one id, and it selects exactly one request.

Each finished request also writes a single-line JSON access log to stdout:

```jsonc
{
  "ts": "2026-08-13T19:03:32.070Z",
  "level": "info", // info < 400, warn 4xx, error 5xx
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "method": "GET",
  "path": "/workspaces/w_1/tasks", // route only — the query string is stripped
  "status": 200,
  "durationMs": 15.444,
  "userId": "0198e2c1-9a11-7c40-8f2b-1d3e5a7c9b02", // omitted when unauthenticated
  "ip": "203.0.113.7", // Express's resolved client IP — see TRUST_PROXY below
}
```

That field list is closed. Request bodies, query strings, headers and cookies are never
logged: the query carries user-supplied filters and search terms, and the headers carry
session cookies and invitation tokens. `ip` is Express's own `req.ip`, not a raw header —
unconfigured, this is always the TCP peer, so behind an unconfigured reverse proxy it is the
proxy's address for every request. See `TRUST_PROXY` below.

## Cross-origin requests

Authentication is a **cookie**, so every request a browser makes to this API carries the
caller's session automatically — including one initiated by a page the caller did not intend
to act on. Three rules decide what the API does about that.

**Reads are governed by CORS.** `WEB_URL` is the single allowed origin, with
`credentials: true`. A `GET` from anywhere else still reaches a handler, but the browser
refuses to hand the response to the calling script.

**Writes must also announce an allowed origin.** `POST`, `PUT`, `PATCH` and `DELETE` are
checked server-side against an allowlist — the same one value, `WEB_URL`, so the browser-side
and server-side lists cannot drift. A request that announces a different origin, in `Origin`
or (when that is absent) in `Referer`, is refused with `403` and the standard error envelope
before it reaches a handler. `Origin: null` — what a sandboxed document or a laundering
redirect sends — is not on the list either. The check covers `/auth/*` as well as the Nest
routes, and Better Auth's own `originCheck` still runs underneath it.

**A request that announces no origin at all is allowed.** That is a deliberate boundary, not
an oversight: browsers are required to send `Origin` on every request whose method is not
`GET`/`HEAD`, `fetch`, XHR and form submissions alike, so there is no cross-site request
shape that carries a victim's cookie _and_ omits the header. Everything left in the
header-less case — `curl`, a CI script, a native client, the web app's own server-side
session lookup in `apps/web/middleware.ts` — cannot be induced by a hostile page to replay
someone else's ambient credentials, which is the entire mechanism the rule defends against.
Rejecting it would break every non-browser caller and close nothing.

The reason the second rule exists at all is that the first is not a fallback for it. A
cross-site `<form method="POST" enctype="application/x-www-form-urlencoded">` is a _simple
request_: the browser sends it with no preflight, so CORS never gets to decide anything, and
the body is parsed and acted on before the response the attacker never needed to read is
discarded. In a deployment where the session cookie is `SameSite=Lax` — which is what
[self-hosting](self-hosting.md)'s single-origin reverse proxy produces, and what Better Auth
emits by default — that request never carries the cookie and the point is moot. The origin
allowlist is what keeps the answer the same in a deployment that publishes the API on its own
domain, where the cookie has to be `SameSite=None` and `Lax` protects nothing.

Operator-facing consequence: **`WEB_URL` must be the exact origin the browser loads the app
from.** A wrong value now costs writes as well as reads. Any spelling of the right origin
works — trailing slash, a path, an explicit `:443` — because the value is reduced to the
origin serialisation a browser sends. A value that is not a URL fails the process at start
rather than producing an allowlist nothing matches.

## Rate limiting

Every endpoint has a request budget. Going over it returns `429` in the error envelope above,
with a `Retry-After` header giving the seconds to wait. Requests still under budget carry
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

Budgets are counted **per client IP and per route** over a rolling minute — one endpoint
running hot never spends another endpoint's allowance.

| Endpoint                                       | Budget        | Why                                                                                    |
| ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| Any endpoint, unless listed below              | 100 / min     | Well clear of what a person generates; caps a script                                   |
| `POST /workspaces/:workspaceId/invitations`    | 10 / min      | Each call hands a message to the SMTP relay, addressed by the caller                   |
| `GET .../boards/:boardId/tasks?q=`             | 30 / min      | `q=` is a trigram scan; the same route without `q=` keeps the default                  |
| `POST .../tasks/:taskId/attachments`           | 20 / min      | The one endpoint where a single request can cost `ATTACHMENT_MAX_BYTES` of disk        |
| `POST .../tasks/:taskId/attachments` (bytes)   | 256 MiB / min | `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`: the same route also has a byte budget, see below |
| `POST /workspaces/:workspaceId/imports/trello` | 3 / min       | A 20 MiB body parsed into heap, then thousands of rows in one transaction              |
| `GET .../attachments/:attachmentId/content`    | 300 / min     | _Above_ the default: a panel with ten image attachments issues ten requests on open    |
| `/auth/sign-in*`, `/auth/sign-up*`             | 3 / 10s       | Better Auth's built-in rule for credential endpoints                                   |
| `/auth/*` otherwise                            | 100 / min     | Better Auth's own limiter — `/auth/*` bypasses the Nest router (ADR 0004)              |
| `GET /health`, `GET /health/ready`             | exempt        | A throttled probe would report a healthy API as down                                   |

**The upload request budget is named as insufficient rather than presented as enough.** The
throttler counts requests per IP per route, which is the wrong unit twice for an upload: twenty
25 MiB requests and twenty 10 kB requests spend the same allowance, and an office behind one NAT
shares a single bucket. The unit that was missing is bytes, and since 2026-08-21 the route
charges them too: `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` (default `268435456`, 256 MiB, about ten
max-size uploads; `0` switches it off) is the most one client IP may submit to the route in a
fixed minute. The charge is the request's `Content-Length`, taken before the body is read, so a
refused request costs the API no heap; a multipart request that declares no length is charged
`ATTACHMENT_MAX_BYTES`, and a JSON body (a LINK, which stores nothing) is not charged at all.
Over budget is `429` with `error: "Upload Budget Exceeded"` where the request throttle's `429`
carries `"Too Many Requests"`, plus `Retry-After` with the rest of the minute; clients branch on
`statusCode` and `error`, never on `message` ([Errors](#errors)). The budget keys on the same
client IP as the request throttle, honours `RATE_LIMIT_ENABLED`, keeps its counters in Redis
when `REDIS_URL` is set and degrades to a per-process counter on Redis errors, exactly as the
`/auth/*` limiter below does. The NAT caveat still applies. What bounds the total is the
per-file size limit plus the per-workspace and per-instance quotas described under
[File uploads and downloads](#file-uploads-and-downloads) ([ADR 0027](decisions/0027-attachment-quotas.md)).
**The import budget is under the same honest caveat and set
lower for it:** three requests is well below the upload budget because one import request costs a
20 MiB parse plus the longest-lived write transaction in this API, and a throttler that counts
requests cannot tell a four-card board from a five-hundred-card one.

Two limiters cover the surface because there are two routers. `/auth/*` is served by raw
Express below Nest, so `ThrottlerGuard` never sees it and Better Auth's own limiter handles
it. Better Auth's counters live in Redis when `REDIS_URL` is set — shared across instances,
surviving restarts — and in process memory otherwise, which is a supported single-instance
configuration. The Nest throttler's counters are always per-instance.

If Redis is configured but a call to it fails mid-operation — an outage, not an unset
`REDIS_URL` — the `/auth/*` limiter does not open up. Each API process falls back to its own
in-memory counter enforcing the same rule until Redis answers again, logged at error level on
the way down and the way back. That fallback is a per-process floor, not the shared limit:
behind N replicas the effective ceiling during the outage is the rule's limit times N, not the
rule's limit — still bounded, unlike allowing every request through.

Both limiters key on the same resolved client IP, driven by one setting: `TRUST_PROXY`
(unset/`false` by default). Off, the app trusts nothing about a request beyond the raw TCP
connection — `req.ip` is always the socket peer, and any `X-Forwarded-For` a client sends is
ignored outright, which is what makes a directly-exposed instance safe from a client spoofing
its way into its own rate-limit bucket. Behind a reverse proxy (Caddy/Traefik terminating TLS
in front of the app), leaving it off means every request looks like it came from the proxy —
one shared budget for every real client, and the access log's `ip` field is equally useless.
Set `TRUST_PROXY` to the hop count (`1` for a single proxy) or the proxy's IP/CIDR, and Express
resolves the real client from `X-Forwarded-For` the same way for both routers. Better Auth
never consults this setting on its own — it re-parses `X-Forwarded-For` itself and would
otherwise accept a spoofed single-value header even with no proxy in front of the app at all —
so `auth/auth.ts` instead points Better Auth's `advanced.ipAddress.ipAddressHeaders` at a
private header the app stamps with the same Express-resolved address on every request,
overwriting anything a client sent. `TRUST_PROXY=true` trusts the entire forwarded chain with
no verification and must only be used when the API is unreachable except through the proxy —
on a directly-exposed instance it hands every attacker an unlimited budget.

`RATE_LIMIT_ENABLED=false` turns both limiters and the upload byte budget off. It exists for the
integration suite, which drives hundreds of requests per route from one address; a deployment
that sets it has no brute-force ceiling.

## Pagination

**Cursor pagination is the default.** Page-number pagination is acceptable only for
genuinely bounded collections (a board's columns) where the total count is small by
construction rather than by expectation.

"Members are always few" was that expectation, and it is how the roster spent a phase
returning a plain array behind `take: 1000` — a workspace past that simply lost its tail,
with nothing in the response saying so. A collection whose size is the user's decision gets
a cursor: an unpaginated list is a promise that the server can always return all of it.

Why cursor by default:

- `OFFSET` degrades linearly on large tables; keyset lookups stay flat.
- Rows are inserted underneath the client mid-session — by another user, and via the
  realtime layer, visibly. Offset pagination handles that worst: every insert before
  the client's window shifts the whole list and the next page repeats or skips rows.

### The cursor key is always `id`, never `position`

**This is a correctness rule, not a preference.** A keyset cursor only guarantees no dropped
rows if the field it is keyed on is _immutable_ for rows the client has not seen yet.
`Task.position` is the opposite of immutable: fractional indexing rewrites it on every
drag-and-drop ([`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)).
A task sitting past the client's cursor that someone drags to the top of the column now has
a `position` _below_ the cursor value — `WHERE position > :cursor` will never return it
again, and the row is silently dropped. Concurrent reordering is exactly why `position`
cannot be the cursor key.

`id` has the properties the cursor needs: it is a **UUIDv7**
([Data types](#data-types)), so it is immutable for the life of the row, monotonic with
insertion time, and index-local — a real keyset, not a random seek.

Board rendering still orders tasks by `position`; the two are separate concerns. `position`
decides where a card _appears_, `id` decides where the _page boundary_ falls. A client
paginating a large task list receives every row exactly once and sorts the accumulated set
by `position` for display.

### Cursor request and response

```
GET /workspaces/w_1/boards/b_1/tasks?limit=50&cursor=0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d
```

| Param    | Default | Max | Notes                                                                                |
| -------- | ------- | --- | ------------------------------------------------------------------------------------ |
| `limit`  | 50      | 100 | Values above the max are clamped, not rejected                                       |
| `cursor` | —       | —   | Opaque. The `id` of the last item from the previous page. Clients must not parse it. |

```jsonc
{
  "items": [/* … resources … */],
  "nextCursor": "0198e2c1-8b6d-7e93-a015-4c2f8d1e6b70", // null on the last page
  "hasMore": true,
}
```

### Page-based (small collections only)

```
GET /workspaces/w_1/some-bounded-collection?page=1&perPage=25
```

```jsonc
{
  "items": [/* … */],
  "page": 1,
  "perPage": 25,
  "total": 7,
  "totalPages": 1,
}
```

No endpoint uses this shape today — every paginated list is a `CursorPage<T>` from
`@kurul/shared-types`. A collection that genuinely needs page numbers may return the
inline shape above until a dedicated type is worth it; do not invent a second shared
pagination default.

A list that fits in one page is still a page. `GET .../members` defaults `limit` to the
`100` ceiling, so an ordinary workspace is one request that answers `hasMore: false` — the
client walks the cursor only when there is something left to walk to.

## Filtering, sorting, field selection

| Concern              | Convention                                    | Example                                                                                                                |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Equality filter      | `?field=value`                                | `?priority=HIGH`                                                                                                       |
| Multiple values (OR) | Repeated or comma-separated                   | `?priority=HIGH,URGENT`                                                                                                |
| Relation filter      | `?relationId=value`                           | `?assigneeId=usr_1&labelId=lbl_2`                                                                                      |
| Range                | `?field[gte]=`, `?field[lte]=`                | `?dueDate[lte]=2026-09-01T00:00:00Z`                                                                                   |
| Null check           | `?field=null`                                 | `?dueDate=null`                                                                                                        |
| Free-text search     | `?q=`                                         | `?q=indexing`                                                                                                          |
| Sorting              | `?sort=field` / `?sort=-field` for descending | Reserved convention — **no list endpoint accepts `sort` yet**; unknown query keys are `400` via `forbidNonWhitelisted` |
| Multi-sort           | Comma-separated, priority left to right       | Same — not wired on any DTO today                                                                                      |

- Combined filters are **AND**; repeated values within one filter are **OR**.
- Only whitelisted fields are filterable and sortable, declared in the query DTO. An unknown
  filter is a `400`, never silently ignored — a silently dropped filter shows the user data
  they asked not to see.
- Default **display** sort for tasks is `position` ascending; for everything else,
  `-createdAt`. Note that a paginated task list is _walked_ by `id` regardless of the
  requested sort — see [Pagination](#the-cursor-key-is-always-id-never-position).
- No `?fields=` sparse-fieldset support. Response shapes are fixed by their DTO; if a client
  needs less, that is not worth the caching and typing complexity.

## DTO naming

| Purpose                  | Pattern                   | Example                          |
| ------------------------ | ------------------------- | -------------------------------- |
| Create request           | `Create<Entity>Dto`       | `CreateTaskDto`                  |
| Full/partial update      | `Update<Entity>Dto`       | `UpdateTaskDto`                  |
| Action request           | `<Verb><Entity>Dto`       | `MoveTaskDto`, `InviteMemberDto` |
| List query params        | `<Entity>QueryDto`        | `TaskQueryDto`                   |
| Single resource response | `<Entity>ResponseDto`     | `TaskResponseDto`                |
| List response            | `<Entity>ListResponseDto` | `TaskListResponseDto`            |

- One DTO per file, in the module's `dto/` folder, named in kebab-case:
  `create-task.dto.ts`.
- `UpdateXDto` derives from `CreateXDto` via `PartialType` rather than restating fields.
- Request DTOs carry `class-validator` decorators; response DTOs are plain shapes mirrored in
  `@kurul/shared-types`.

Full DTO/validation rules: [coding-standards.md](coding-standards.md#dtos-and-validation).

## Data types

| Type            | Representation                                                                                                                                                   | Example                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Identifier      | **UUIDv7**, generated by Prisma's `@default(uuid(7))` (available since Prisma 5.18). Opaque to clients: never parsed, never sorted, never generated client-side. | `"0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d"` |
| Date/time       | **ISO 8601, always UTC, always with `Z`**                                                                                                                        | `"2026-08-08T09:12:31.114Z"`             |
| Date-only value | Still a full ISO 8601 timestamp at `T00:00:00.000Z`                                                                                                              | `"2026-09-01T00:00:00.000Z"`             |
| Duration        | Integer minutes (`estimatedMinutes`) — never a formatted string                                                                                                  | `240`                                    |
| Position        | `Float` (fractional indexing) — never assume integers or contiguity                                                                                              | `1024.5`                                 |
| Enum            | UPPER_SNAKE string, defined in shared types                                                                                                                      | `"HIGH"`, `"OWNER"`                      |
| Money           | Not used yet. When it is: integer minor units + currency code.                                                                                                   | —                                        |

The API never returns local time or a timezone offset. Formatting for the user's locale is
the frontend's job.

"Opaque" cuts both ways. UUIDv7 embeds a timestamp, and the server relies on that ordering
for cursor pagination — but clients must not. A client that sorts by `id` or reads a
creation time out of it is depending on an implementation detail that a future id strategy
would break. URL examples in this document abbreviate ids (`w_1`, `b_1`, `t_1`) for
readability; real ones are 36-character UUIDv7 strings.

## The OpenAPI document

This document is prose. The machine-readable one is **[`apps/api/openapi.json`](../apps/api/openapi.json)**,
generated from the running application — every path, parameter, request body and response in it
is what the NestJS router and the DTO classes actually declare.

**The two are not ranked.** Where the spec and this page disagree, one of them is wrong and
neither wins by default: this page carries the reasons, the spec carries the shapes, and a
disagreement means somebody changed a shape without revisiting the reason. Fix the wrong one.

|                       |                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Interactive console   | `GET /docs`                                                                                       |
| Document              | `GET /openapi.json` — byte-identical to the committed file                                        |
| Same document as YAML | `GET /docs-yaml` — `@nestjs/swagger` serves it alongside; the JSON is the one this project checks |
| Committed snapshot    | `apps/api/openapi.json`                                                                           |
| Regenerate            | `pnpm openapi` (builds the API first)                                                             |
| Verify                | `pnpm openapi:check` — exits non-zero on any difference                                           |

**`/docs` is off in production unless `API_DOCS_ENABLED=true`.** Development gets it by
default. That asymmetry is a decision about a self-hosted service, and it has three parts: the
document itself leaks little (this is an AGPL project and the routes are public), but `/docs`
is an unauthenticated **HTML page** on a service that renders no documents and locks itself to
`default-src 'none'` — so publishing it means carving a Content-Security-Policy exception for
one path — and its "Try it out" console issues real same-origin requests carrying the reader's
own session cookie. An operator who never chose this API should get that on purpose, not by
inheritance. Turning it off costs no discoverability: the identical document is in the
repository.

**CI fails when the spec drifts.** The `build` job regenerates the document and compares it to
the committed file, so adding an endpoint, renaming a field, widening a `@MaxLength` or
changing a role gate all turn CI red until `apps/api/openapi.json` is regenerated in the same
change. The gate is the generator's own exit code, not a grep over its output.

Two things are deliberately **absent** from the spec, and both are absent because they are not
Nest routes:

- **`/auth/*`.** Better Auth is mounted on raw Express below the Nest router
  ([ADR 0004](decisions/0004-auth-better-auth.md)), so there is no controller to scan.
- **The Socket.io contract.** Not HTTP. It lives in `@kurul/shared-types` and in
  [architecture.md](architecture.md).

## Versioning

**No `/v1` prefix before 1.0.** Adding a version segment now would imply a compatibility
promise the project is not making — and would have to be bumped repeatedly during the very
period the API is expected to churn. See
[git-strategy.md](git-strategy.md#versioning-policy-semver).

Until 1.0:

- Breaking API changes may ship in any `0.y.0` release.
- Every one is documented in `CHANGELOG.md` under `### Changed` / `### Removed`, with the
  old and new shape and a migration note.
- `@kurul/shared-types` is versioned with the monorepo, so a client that pins the package
  version pins the contract.

At 1.0, the API is frozen behind SemVer. If a versioning scheme is needed after that, it will
be introduced by ADR — URI prefix (`/v1`) is the likely choice, decided when it is actually
needed rather than pre-emptively.

## See also

- [architecture.md](architecture.md) — module map, data model, socket contract
- [coding-standards.md](coding-standards.md) — DTOs, validation, module boundaries
- [testing.md](testing.md) — what endpoint tests assert
- [git-strategy.md](git-strategy.md) — SemVer and changelog policy
