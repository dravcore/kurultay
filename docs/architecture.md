# Architecture

The shape of the Kurul system: how the code is stored, how it runs, and how the data is modelled.

> 🌐 English (canonical) | [Türkçe](tr/architecture.md)

## Contents

- [1. Decision summary](#1-decision-summary)
- [2. Monorepo layout](#2-monorepo-layout)
- [3. apps/api — module map](#3-appsapi--module-map)
- [4. apps/web — structure](#4-appsweb--structure)
- [5. packages/shared-types](#5-packagesshared-types)
- [6. Data model](#6-data-model)
- [7. Multi-tenant isolation](#7-multi-tenant-isolation)
- [8. Runtime evolution](#8-runtime-evolution)
- [9. Accepted runtime trade-offs](#9-accepted-runtime-trade-offs)
- [10. Decision records](#10-decision-records)
- [11. Security headers](#11-security-headers)

---

## 1. Decision summary

Kurul is a **monorepo** containing a **modular monolith**.

These are two independent axes, and keeping them apart matters:

| Axis                       | Question it answers       | Kurul's answer                       |
| -------------------------- | ------------------------- | ------------------------------------ |
| Monorepo vs. polyrepo      | How is the code _stored_? | Monorepo (single pnpm workspace)     |
| Monolith vs. microservices | How does the code _run_?  | Modular monolith (single deployable) |

**Why monorepo**

- Frontend and backend are both TypeScript, so `packages/shared-types` can hold one definition of task/board types. A data model change happens in one place.
- Single maintainer / small team: two repos means two PRs and manual version alignment for every cross-cutting change.
- Contribution barrier: a contributor clones one repo and runs `docker compose up`.
- Most reference projects in this space (Plane, Huly) are monorepos.

**Why modular monolith, not microservices**

- Microservices buy independent scaling at the cost of distributed-system complexity: inter-service calls, distributed transactions, separate deploy pipelines, distributed observability. At MVP scale there is nothing to scale independently yet.
- Kanban is highly coupled by nature. Moving one task touches the task row, the activity log, notifications, and dashboard aggregates — one local transaction today, a distributed transaction if split.
- The data model is not settled. Drawing service boundaries early is the expensive kind of mistake: fixing a wrong split costs far more than splitting a monolith later.

**What the references do**

| Project | Approach                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plane   | Monolith at the core, plus two support services (Gateway = DB proxy, Pilot = integration surface)                                                                   |
| Linear  | One codebase, deployed as several workloads with different roles: WebSocket servers, public/private GraphQL API, background job runners — each scaled independently |
| Huly    | Monorepo with many services, at the cost of building their own Rush-based build system                                                                              |

Linear's model is the one Kurul follows: **one codebase, several process roles when needed.** Running the WebSocket server as its own container means splitting the deployment, not the code.

Full rationale: [`decisions/0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md).

---

## 2. Monorepo layout

```
kurul/
├── apps/
│   ├── api/               # NestJS backend (modular monolith)
│   └── web/               # Next.js App Router frontend
├── packages/
│   ├── shared-types/      # TS types / DTOs shared by api and web
│   └── auth-access/       # Better Auth organization AC roles (api + web)
├── pnpm-workspace.yaml
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example
```

Live layout is this document and the repo tree. Technology choices:
[tech-stack.md](tech-stack.md).

---

## 3. apps/api — module map

Every module has the same skeleton: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`. Module boundaries are kept clean from day one — the ability to split process roles later depends entirely on that.

**Current vs planned:** after Phase 9, feature modules including `realtime` are implemented.
Treat the table below as the module map.

| Module         | Responsibility                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`         | Better Auth integration, session handling, request user resolution                                                                                                                                                                               |
| `account`      | Account erasure: `DELETE /me` and the instance operator's `DELETE /instance/users/:userId`, over one engine that anonymises the `User` row rather than deleting it ([ADR 0026](decisions/0026-account-deletion-anonymisation.md))                |
| `workspace`    | Workspace CRUD, membership, invitations, roles                                                                                                                                                                                                   |
| `board`        | Board and column management, column ordering                                                                                                                                                                                                     |
| `task`         | Task CRUD, moving between columns, fractional-index reordering                                                                                                                                                                                   |
| `label`        | Board-scoped labels and task-label assignment                                                                                                                                                                                                    |
| `comment`      | Task comments                                                                                                                                                                                                                                    |
| `attachment`   | Files and links on a task: upload, list, download stream, detach                                                                                                                                                                                 |
| `import`       | One-way Trello board import: read an export, plan the rows, write them once                                                                                                                                                                      |
| `activity`     | Append-only activity log (`payload` is Json)                                                                                                                                                                                                     |
| `dashboard`    | Aggregation queries feeding the charts                                                                                                                                                                                                           |
| `notification` | Notification fan-out, Redis-backed queue; `NotificationMailer` sends one email per stored row through `mail`, after commit, unless the recipient opted out                                                                                       |
| `realtime`     | Socket.io gateway + `@socket.io/redis-adapter`                                                                                                                                                                                                   |
| `retention`    | Nightly data-retention sweep; no controller, no exported provider                                                                                                                                                                                |
| `mail`         | SMTP delivery (`nodemailer`); logs instead of sending when unconfigured                                                                                                                                                                          |
| `locale`       | Stored interface language: reads/writes `User.locale`, resolves it for a request                                                                                                                                                                 |
| `config`       | `GET /config` — the two capability flags the UI branches on (`mailEnabled`, `attachmentsEnabled`), unauthenticated                                                                                                                               |
| `activation`   | Instance-local activation funnel and North Star, computed on demand from existing rows; readable only by `INSTANCE_ADMIN_EMAILS` once those accounts' emails are verified ([ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md)) |
| `telemetry`    | Opt-in, default-off outbound ping at boot; sends nothing unless `TELEMETRY_ENABLED` and `TELEMETRY_ENDPOINT` are both set ([ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md))                                                 |
| `health`       | Liveness probe (`GET /health`) and readiness probe (`GET /health/ready`, which probes DB and Redis and answers `503` with a diagnostic body), both unauthenticated                                                                               |

Cross-cutting infrastructure:

| Module    | Responsibility                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common`  | Guards, exception filters, decorators, shared Nest bootstrap — workspace scoping (guard-enforced today; request-scoped Prisma Client Extensions deferred)                                                                                                    |
| `prisma`  | Shared `pg` pool + Nest `PrismaService`; Better Auth uses the same pool                                                                                                                                                                                      |
| `storage` | The `StorageBackend` port and its one implementation, local disk. Modelled on `mail` — `STORAGE_PATH` being set is what enables it, and callers branch on the capability, never on the backend's identity ([ADR 0022](decisions/0022-attachment-storage.md)) |

Dependency direction: feature modules depend on `common` and `prisma`, never the reverse. `realtime` is a consumer of domain events, not a place where domain logic lives — so it can be lifted into its own process role without dragging business rules with it.

**Scheduled jobs.** Two, both BullMQ job schedulers on `REDIS_URL`, both registered from the
module that owns them and closed on `onModuleDestroy`. `notification/due-soon.worker.ts`
scans for approaching due dates every 15 minutes and only ever inserts.
`retention/cleanup.worker.ts` deletes rows past their retention window once a day
([ADR 0020](decisions/0020-data-retention.md)). With `REDIS_URL` unset neither starts, which
is a supported single-instance configuration for the first and a disabled retention policy
for the second. Both are the `worker` role that stage 2 of [§8](#8-runtime-evolution) splits
out; nothing else in the API runs off a request.

**`import` is shaped the other way round from every other write module, on purpose.** All of the
decision-making is in two pure functions — a reader (`trello-export.ts`) that narrows raw JSON to
a shape this code understands, and a planner (`trello-import-planner.ts`) that turns it into the
exact rows to write plus the report of what it refused. Neither touches a database. The service
then opens **one** transaction with no branches in it: every row that reaches it is already known
to be writable. That is what makes a board atomic while its coverage is partial, and it is why a
malformed export costs a `400` and writes nothing. It adds **no table and no column** — the import
uses `Board`, `Column`, `Task`, `Label`, `Checklist`, `ChecklistItem` and `Attachment` as they
already are — and it owns its own `MulterModule` rather than sharing `attachment`'s, because the
two ceilings measure different resources and because an import stores no bytes and therefore works
on an instance with no `STORAGE_PATH` ([ADR 0025](decisions/0025-trello-import-mapping.md)).

`retention` is its own module rather than a provider inside `notification` because it is the
one component that deletes across module and tenant boundaries by design — `Session`,
`Verification`, `Notification` and `Activity` belong to three modules and to no workspace.
It is also the single sanctioned exception to §7: it runs with no caller, so there is nothing
to isolate. See the ADR.

`locale` is a module rather than a `common/` helper because `auth` and `board` both need it and the boundary rule says they depend on the module, not on each other. It is the only locale awareness the API has, and it is confined to the two cases [ADR 0018](decisions/0018-localization-strategy.md) allows: content written into the database on the user's behalf (a new board's seed columns) and outbound email. Interface translation stays entirely on the web.

---

## 4. apps/web — structure

```
apps/web/
├── app/
│   ├── (auth)/            # login, register, invite — unauthenticated shell
│   ├── (app)/             # authenticated shell: sidebar + workspace switcher
│   │   ├── dashboard/
│   │   ├── notifications/
│   │   ├── settings/
│   │   ├── workspaces/new/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── layout/            # AppShell, Topbar, WorkspaceProvider, AppSidebar, SancakRail
│   ├── auth/              # shared auth form primitives
│   ├── brand/             # DamgaMark and other brand marks
│   ├── ui/                # shadcn/ui primitives (landed Phase 3)
│   ├── board/             # BoardList, BoardView, BoardColumn, dialogs
│   ├── task/              # TaskCard, TaskPanel, metadata editors, DnD helpers
│   ├── dashboard/         # chart components (Phase 7+)
│   ├── notification/      # NotificationBell, NotificationsList
│   └── settings/          # LanguageSettings
├── i18n/                  # next-intl request config + the locale resolution chain
├── messages/              # en.json, tr.json — UI copy, one flat file per locale
└── lib/
    ├── api.ts             # typed REST client
    ├── socket.ts          # Socket.io client (board realtime)
    ├── board-permissions.ts
    └── auth.ts            # Better Auth client (`@kurul/auth-access`)
```

Two route groups split the layout tree: `(auth)` renders a bare shell, `(app)` renders the workspace chrome and assumes a session. Next.js middleware checks the Better Auth session cookie against `/auth/get-session` before `(app)` routes run; the client shell still bootstraps workspaces once the session is present. Board interaction uses `@dnd-kit` with the server as the source of truth — an optimistic move is reconciled against the API response and against inbound socket events.

**i18n:** `next-intl` is wired from Phase 1 (`i18n/request.ts`, `NextIntlClientProvider` in the
root layout, UI copy in `messages/en.json`) so every user-facing string already goes through
`useTranslations()` rather than being hardcoded. The locale is resolved per render through
`User.locale → locale cookie → Accept-Language → 'en'`
([ADR 0018](decisions/0018-localization-strategy.md)) — deliberately **no `[locale]` path
segment and no i18n middleware**, because nothing here is indexed and a language prefix would
invalidate every literal path comparison in `middleware.ts` at once. Settings → Language writes
the preference; `en` and `tr` ship today (`SUPPORTED_LOCALES = ['en', 'tr']`, `messages/tr.json`
at parity with `en.json`), so adding a third language is a `SUPPORTED_LOCALES` entry plus a
`messages/<tag>.json` — and the `Record<Locale, …>` seed and mail copy (`board-defaults.ts`,
`mail-templates.ts`) failing to compile until it is filled in — not a rewrite of the component
tree. See [ROADMAP.md — Beyond MVP](../ROADMAP.md#beyond-mvp) for additional UI language packs.

---

## 5. packages/shared-types

The single source of truth for anything that crosses the wire. Backend and frontend import the same declarations, so a drift between them becomes a type error rather than a runtime surprise.

| Content         | Examples                                                                           |
| --------------- | ---------------------------------------------------------------------------------- |
| Enums           | `Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot` (`slot-1`…`slot-8`) |
| DTO types       | Workspace, Board, Column, Task, Label, Invitation request/response shapes          |
| Pagination      | `CursorPage<T>` (default list shape; keyed on `id`)                                |
| Socket contract | Event name constants and their payload types                                       |

Better Auth organization **roles / access-control** live in `@kurul/auth-access` (not in this package), so api and web share one AC definition without pulling Better Auth into the types package.

Enums and DTOs are **hand-maintained** to match the Prisma schema today; a mechanical Prisma→shared-types codegen path remains an aspiration (see ADR 0002). The package stays free of a runtime Prisma dependency. The Prisma 7 client still emits to `apps/api/src/generated/prisma` for Nest and the Better Auth adapter.

---

## 6. Data model

| Model             | Key fields                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`            | `id`, `email`, `name`, `avatarUrl`, `locale`, `emailNotifications`, `createdAt`                                                                      | Identity, owned by Better Auth; `locale` is nullable and means "follow the browser" when unset; `emailNotifications` defaults to `true` and is the one switch for notification email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Workspace`       | `id`, `name`, `slug`, `createdAt`                                                                                                                    | Tenant root — everything hangs off this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `WorkspaceMember` | `id`, `workspaceId`, `userId`, `role`                                                                                                                | Join table; `role` drives permissions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Board`           | `id`, `workspaceId`, `name`, `description`, `createdAt`                                                                                              | Boards belong to a workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Column`          | `id`, `boardId`, `name`, `position`, `color`, `category`                                                                                             | `position` orders columns within a board. `category` (`UNSTARTED` / `STARTED` / `COMPLETED`) is the semantic stage metrics and the dashboard key off — never the display name ([ADR 0019](decisions/0019-column-category.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Task`            | `id`, `boardId`, `columnId`, `title`, `description`, `priority`, `position`, `dueDate`, `estimatedMinutes`, `createdById`, `createdAt`, `updatedAt`  | The core entity — see rules below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `TaskAssignee`    | `id`, `taskId`, `userId`                                                                                                                             | Join table; multiple assignees per task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Label`           | `id`, `boardId`, `name`, `color`                                                                                                                     | Board-scoped. `color` stores a design-token slot name (`slot-1`…`slot-8`), resolved per theme — not a raw hex; see [design.md](design.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `TaskLabel`       | `id`, `taskId`, `labelId`                                                                                                                            | Join table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Comment`         | `id`, `taskId`, `userId`, `body`, `createdAt`                                                                                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Checklist`       | `id`, `taskId`, `title`, `position`, `createdAt`, `updatedAt`                                                                                        | Multi-list per card — a task has zero or more checklists ([ADR 0023](decisions/0023-checklist-data-model.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ChecklistItem`   | `id`, `checklistId`, `content`, `isDone`, `position`, `createdAt`, `updatedAt`                                                                       | Completion percentage is counted at read time from whichever checklist items are loaded, never stored ([ADR 0023](decisions/0023-checklist-data-model.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Attachment`      | `id`, `taskId`, `uploadedById`, `kind`, `filename`, `storageKey` (nullable), `mimeType` (nullable), `size` (nullable), `url` (nullable), `createdAt` | `kind` is `AttachmentKind` — `FILE` or `LINK` — and it is what says which of the nullable columns are populated; it is never inferred from them. A `FILE` carries `storageKey`/`mimeType`/`size`, a `LINK` carries `url`. `mimeType` is what the magic bytes said, never what the client declared. `storageKey` is derived from the row's own `id` on the server, so the user's filename is a display field that never reaches a path. No `position`: attachments are not user-ordered and come back newest-first by `id` ([ADR 0024](decisions/0024-attachment-kinds-and-serving-policy.md)). Per-workspace and per-instance byte quotas apply on top of the per-file size limit ([ADR 0027](decisions/0027-attachment-quotas.md)) |
| `Activity`        | `id`, `workspaceId`, `taskId` (nullable), `userId`, `type`, `payload` (Json), `createdAt`                                                            | Append-only log. `workspaceId` is required and `taskId` is optional so that workspace-level events with no task — "board renamed", "member joined" — are representable, which is what the Phase 8 feed promises. `taskId` uses `ON DELETE SET NULL` so history survives task deletion.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Notification`    | `id`, `workspaceId`, `userId`, `type`, `taskId` (nullable), `activityId` (nullable), `payload` (Json), `readAt` (nullable), `createdAt`              | In-app alerts (assignment, mention, due-soon), each also emailed when SMTP is configured and the recipient has not opted out. Fan-out from activity writes; due-soon via BullMQ on `REDIS_URL`. See Phase 8 of the MVP ([ROADMAP.md](../ROADMAP.md#shipped-mvp-summary))                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Invitations persist as `WorkspaceInvitation`, mapped from Better Auth's organization
plugin tables (Kurul names, plugin `schema` config). Product language and REST
paths use **Workspace** — see [ADR 0004](decisions/0004-auth-better-auth.md#domain-mapping-organization--workspace).

Better Auth also manages the auth infrastructure tables `Session`, `Account`, and `Verification`, which are plugin-managed and deliberately omitted from the domain model table above.

### Audit trail

`Activity` carries two kinds of row. The task feed — created, updated, moved, assigned,
commented — is what a board member reads. The administrative events are what an operator reads
after an account is compromised or someone leaves badly: they record every act that changes
**who can reach a workspace**, or that **destroys work**.

| Event                                                               | Written by                   | Payload beyond the actor                                                     |
| ------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `board.created` · `board.updated` · `board.deleted`                 | `BoardService`               | board id, name, `changes`, deleted board's `taskCount`                       |
| `column.created` · `column.updated` · `column.deleted`              | `ColumnService`              | column id, board id, name, `category`, `changes`                             |
| `label.created` · `label.updated` · `label.deleted`                 | `LabelService`               | label id, board id, name, colour slot, `changes`                             |
| `workspace.updated`                                                 | `WorkspaceService`           | name, slug, `changes`                                                        |
| `member.removed` · `member.left` · `member.role_changed`            | `WorkspaceMemberService`     | target user, target name, `previousRole`, `newRole`, actor's role            |
| `invitation.created` · `invitation.revoked` · `invitation.accepted` | `WorkspaceInvitationService` | invitation id, granted role, `emailDelivery` — **never the invited address** |
| `task.deleted`                                                      | `TaskService`                | task id, title, board and column                                             |

Four properties are deliberate:

- **`changes` records both sides.** Administrative events store `{ field: { from, to } }`, not
  the `{ field: newValue }` shape the task feed uses. An audit entry is read backwards by
  someone reconstructing what an account did, and the interesting half is usually the value
  that is gone: "renamed the board to Archive" does not identify what was hidden.
- **Deletions are recorded inside the transaction that performs them, before the delete.** The
  name of a deleted board or label exists nowhere else afterwards. Creations may be recorded
  immediately after the insert instead, because a lost creation entry still leaves the created
  row standing as evidence.
- **A payload never widens who can read something.** `GET /workspaces/:workspaceId/activities`
  is `@WorkspaceScoped()` and returns `payload` verbatim, so anything written there is readable
  by every member down to GUEST. The pending-invitation list is `@WorkspaceRoles(...ADMIN_ROLES)`
  precisely because an invited address belongs to someone who has agreed to nothing yet, so
  `invitation.*` payloads carry the **invitation id and role only** — an admin joins
  `WorkspaceInvitation` for the address. Forensic value is kept; the audience is not enlarged.
- **`AUDIT_ACTIVITY_TYPES`** (`@kurul/shared-types`) is the exported list of these types, so
  "who removed, granted or destroyed something here?" is one statement —
  `WHERE "workspaceId" = $1 AND type = ANY($2) ORDER BY id DESC`, served by the existing
  `(workspaceId, type, createdAt)` index.

**One event cannot live in the table: `workspace.deleted`.** `Activity` cascades on
`workspaceId`, so the row would be deleted by the statement it describes.
`WorkspaceService.remove` therefore writes it to the JSON-line log instead
(`common/logging/json-log.ts`, the same transport the access log and the retention sweep use):
`{ ts, level: 'warn', event: 'workspace.deleted', workspaceId, actorId, name, slug, memberCount, boardCount }`,
gathered before the delete because none of it can be looked up afterwards. Read it with
`docker logs … | jq 'select(.event == "workspace.deleted")'`. On a deployment that must retain
deletion records, ship the application log.

**One event lives in both places: `account.deleted`.** Deleting an account writes an
`account.deleted` activity row into every workspace the person was a member of — carrying
`targetUserId`, `previousRole` and `initiatedBy`, and deliberately **no name**, since a row
written to stop naming somebody must not name them. Its actor is the departing user and never
the instance operator who may have ordered it, so an operator's identity cannot appear in a
tenant's feed. The operator's half goes to the JSON log instead:
`{ ts, level: 'warn', event: 'account.deleted', userId, initiatedBy, actorId, …counts }`, with
no address and no name for the same reason the retention sweep logs counts only. A workspace a
disposition deleted gets no activity row at all — the same cascade problem `workspace.deleted`
has — and produces a `workspace.deleted` line carrying `deletedWithAccount`.
[ADR 0026](decisions/0026-account-deletion-anonymisation.md).

Audit rows are swept by the same retention window as any other activity
(`ACTIVITY_RETENTION_DAYS`, default 365; `0` keeps them forever —
[ADR 0020](decisions/0020-data-retention.md)).

### Critical field rules

These are non-negotiable; they are also recorded in `CLAUDE.md`.

| Rule                                                           | Reason                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `id` is **UUIDv7** (`@default(uuid(7))`)                 | Time-ordered, so keys stay index-local on insert-heavy tables and serve as a stable pagination cursor. See [api-conventions.md](api-conventions.md#data-types)                                                                                             |
| `Task.position` and `Column.position` are **Float**, never Int | Fractional indexing. Inserting between positions `1` and `2` writes `1.5` — one row updated instead of renumbering the whole list. Applies to both cards and columns. See [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` and `estimatedMinutes` are **separate fields**       | "By when" and "how long" are different concepts; a future Gantt view needs both                                                                                                                                                                            |
| `priority` is **separate from labels**                         | Keeps filtering and dashboard aggregation clean — priority is an ordered scalar, labels are an unordered set                                                                                                                                               |
| `Activity.payload` is **Json**                                 | New activity types can be added without a schema migration                                                                                                                                                                                                 |

### Constraints and referential actions

The join tables carry a surrogate `id` for convenience, but the natural key is what the
database enforces:

| Constraint                                        | Prevents                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceMember @@unique([workspaceId, userId])` | One user holding two roles in the same workspace                                                                                                                                                                    |
| `TaskAssignee @@unique([taskId, userId])`         | The same assignee counted twice in lists, notifications, and activity payloads                                                                                                                                      |
| `TaskLabel @@unique([taskId, labelId])`           | The same label attached twice                                                                                                                                                                                       |
| `Column @@unique([boardId, id])`                  | Exists solely so `Task` can declare a composite foreign key `(boardId, columnId) → Column(boardId, id)`, making "a task's column is on the task's board" a database guarantee rather than an application-only check |

**Deletes cascade deliberately.** Prisma's default action on a required relation is
`Restrict`, so leaving this unstated would mean board deletion _fails_ — the more surprising
of the two defaults. Owned children cascade
(`Workspace → Board → Column, Task → Comment, Activity, TaskAssignee, TaskLabel`).
References to `User` do not: a comment or activity row outliving its author is correct, and
deleting a user has to be a deliberate operation rather than a silent erasure.

---

## 7. Multi-tenant isolation

Every workspace is a tenant, and the isolation rule is absolute: **every query is scoped by `workspaceId`.**

That rule is enforced by `WorkspaceGuard` (membership) plus **service-level `workspaceId`
predicates** on every Prisma read/write. Request-scoped Prisma Client Extensions remain
deferred — a new handler that queries by bare resource id without a tenant predicate is a
bug, not something the guard can paper over:

1. A guard resolves the current user's membership in the requested workspace and rejects the request if there is none (404 for non-members — anti-enumeration).
2. The resolved `workspaceId` / membership role is attached to the request context.
3. Services take `workspaceId` from the controller and filter every query with it (or via the parent chain `board: { workspaceId }`).
4. Nested resources are validated through their parent chain (task → board → workspace) so a valid id from another tenant cannot be smuggled in.
5. Workspace/org **mutations** go through Nest `/workspaces/*` only — Better Auth `/auth/organization/*` mutation HTTP is firewalled so Nest policy cannot be bypassed.

**One exception, and only one:** the retention sweep
(`retention/cleanup.worker.ts`, [ADR 0020](decisions/0020-data-retention.md)) deletes
globally, with no `workspaceId` predicate. The rule above exists to stop a _caller_ reaching
another tenant's rows; the sweep has no caller, no session and no route — and `Verification`
has no tenant column to scope by at all. Anything reachable from a request stays scoped.

Membership `role` (`OWNER`/`ADMIN`/`MEMBER`/`GUEST`) is checked in the same layer for permission decisions. Scaffold controllers use `/workspaces/:workspaceId/...` so `WorkspaceGuard` can read `params.workspaceId` when handlers arrive. Coding review treats any query without workspace scoping as blocking ([coding-standards.md](coding-standards.md#multi-tenant-isolation)).

---

## 8. Runtime evolution

The staged path is deliberate: the microservice door stays open, the cost is simply not paid up front.

| Stage       | Trigger             | Runtime                                                                                                           |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| MVP         | Now                 | One NestJS process (`api`) + `web` + `postgres` + `redis`                                                         |
| Split roles | Traffic growth      | Same codebase, same image, different roles: `api`, `ws` (Socket.io), `worker` (queue) — three services in Compose |
| Extract     | A proven bottleneck | Pull _only_ that module into its own service                                                                      |

Reaching stage 2 requires no architectural change — clean NestJS module boundaries are the whole prerequisite. Stage 3 is only entered against evidence, never speculation.

---

## 9. Accepted runtime trade-offs

Two behaviours below are deliberate compromises, not oversights. Each was argued in a code
comment at the point it was accepted and nowhere else, which meant the only way to learn
about them was to already be reading the file. They are small enough not to warrant an ADR
each, and consequential enough that an operator debugging a shutdown or a stale session
should not have to rediscover them from source.

### 9.1 Shutdown ordering is owned by one module, not by Nest

`PrismaService` and Better Auth's own `PrismaClient` both borrow from a single process-wide
`pg` pool (`api/src/prisma/database.ts`). Two clients, one pool, and **Nest gives no ordering
guarantee between `onModuleDestroy` hooks** — so whichever module happens to be torn down
first would end the pool out from under the other, and the survivor's `$disconnect()` would
throw `Called end on pool more than once` / `cannot use a pool after calling end` on every
SIGTERM.

The resolution is that no module disconnects its own client. `database.ts` is the sole owner
of the pool's lifecycle: clients register a disconnect callback via `registerPoolConsumer`,
and `closeSharedDatabase` drains every registered client before ending the pool. It is
idempotent and concurrency-safe — the first caller owns the shutdown, later or parallel
callers await the same promise — so it genuinely does not matter which hook Nest runs first.

| Trade-off                                   | Accepted because                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One shared pool                             | Two pools would double the connection count against Postgres `max_connections` for no benefit — both clients talk to the same database with the same credentials                                      |
| Lifecycle held in module state              | The alternative is a Nest provider that both modules inject, which is more wiring to express the same "one owner" rule; Better Auth's client is constructed at module scope, outside Nest's DI anyway |
| A failed disconnect does not block shutdown | `closeSharedDatabase` uses `Promise.allSettled` — one client that cannot disconnect must not strand the pool open and hang the process past its termination grace period                              |

What this means in practice: **a "pool already ended" error at shutdown is a bug in this
contract, not a transient.** It means some code disconnected a client directly instead of
registering it. Any future client that borrows the shared pool must call
`registerPoolConsumer`.

### 9.2 Session revocation lags by up to 60 seconds; role revocation does not

Better Auth is configured with `session.cookieCache` at `maxAge: 60`
(`api/src/auth/auth.ts`). The signed session cookie is trusted without a database round trip
until it expires, which removes one query from every authenticated request.

The cost is precise: **revoking a session takes effect up to 60 seconds late.** Deleting the
session row does not invalidate a cookie already in a browser's possession; that cookie
remains accepted until its cache window lapses.

What is _not_ affected is more important than what is:

| Change                                 | Takes effect                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Session revoked / signed out elsewhere | Up to 60 seconds late — the cookie is trusted until its cache expires                           |
| Role changed (e.g. ADMIN → GUEST)      | **Immediately** — `WorkspaceGuard` reads `WorkspaceMember` from the database on every request   |
| Removed from a workspace               | **Immediately** — same guard, same read; the membership row is gone and the request 404s        |
| Email verified                         | Immediately — `autoSignInAfterVerification` rewrites the cookie, which is why that option is on |

So the window is a _session-identity_ window, not an _authorization_ window. A demoted or
ejected member cannot act on their old role for 60 seconds; only a signed-out browser can
keep reading for up to 60 seconds with a cookie it already held. That asymmetry is what
makes the trade acceptable at this scale, and it exists because the guard was deliberately
not allowed to trust anything cached.

If a deployment ever needs immediate session revocation — a security incident, a
compliance requirement — the lever is `session.cookieCache.enabled: false`, paid for with one
database read per authenticated request.

---

## 10. Decision records

The reasoning behind each of these choices is recorded as an ADR:

| ADR                                                                                                          | Topic                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md)                           | Monorepo + modular monolith                                                                              |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md)                                                   | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8                                                           |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md)                                                 | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts                                                  |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md)                                             | Better Auth with the organization plugin (→ Workspace)                                                   |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md)                                           | Socket.io + Redis adapter                                                                                |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)                                       | Float positions for ordering                                                                             |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md)                                                     | AGPL-3.0                                                                                                 |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md)                                               | Git Flow + SemVer                                                                                        |
| [`0009-board-column-permissions.md`](decisions/0009-board-column-permissions.md)                             | Board and column Nest `@Roles` matrix                                                                    |
| [`0010-task-permissions.md`](decisions/0010-task-permissions.md)                                             | Task Nest `@Roles` matrix                                                                                |
| [`0011-label-task-metadata-permissions.md`](decisions/0011-label-task-metadata-permissions.md)               | Label and task-metadata Nest `@Roles` matrix                                                             |
| [`0012-comment-delete-authorship.md`](decisions/0012-comment-delete-authorship.md)                           | Comment delete: authorship or OWNER/ADMIN                                                                |
| [`0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)                   | SMTP mail delivery, email verification on invitation accept only                                         |
| [`0014-dual-licensing-cla.md`](decisions/0014-dual-licensing-cla.md)                                         | Dual licensing + contributor license agreement (superseded by 0028)                                      |
| [`0015-no-external-contributions.md`](decisions/0015-no-external-contributions.md)                           | No external contributions; CLA unenacted, legal spend deferred (superseded by 0028)                      |
| [`0016-foreign-key-violation-status.md`](decisions/0016-foreign-key-violation-status.md)                     | Prisma `P2003` maps to `409`, not `422`                                                                  |
| [`0017-partial-indexes-outside-prisma-schema.md`](decisions/0017-partial-indexes-outside-prisma-schema.md)   | Partial indexes live in migrations, guarded by tests                                                     |
| [`0018-localization-strategy.md`](decisions/0018-localization-strategy.md)                                   | Locale chain, no `[locale]` routing, API seeds/email only                                                |
| [`0019-column-category.md`](decisions/0019-column-category.md)                                               | Column completion is a category, not a name                                                              |
| [`0020-data-retention.md`](decisions/0020-data-retention.md)                                                 | Per-table retention windows, enforced by a nightly sweep                                                 |
| [`0021-activation-funnel-and-opt-in-telemetry.md`](decisions/0021-activation-funnel-and-opt-in-telemetry.md) | Activation Funnel In-Instance, Telemetry Opt-In and Off by Default                                       |
| [`0022-attachment-storage.md`](decisions/0022-attachment-storage.md)                                         | Attachment Storage: Local Disk Behind a Port, Served From the API Origin                                 |
| [`0023-checklist-data-model.md`](decisions/0023-checklist-data-model.md)                                     | Checklist Data Model: Multi-List Per Card, Derived Progress, No New Realtime Event                       |
| [`0024-attachment-kinds-and-serving-policy.md`](decisions/0024-attachment-kinds-and-serving-policy.md)       | Attachment Kinds and Serving Policy: FILE or LINK, One Size Number in Two Layers, Inline Only for Images |
| [`0025-trello-import-mapping.md`](decisions/0025-trello-import-mapping.md)                                   | Trello Import Mapping: Nothing Is Guessed, Everything Missing Is Counted                                 |
| [`0026-account-deletion-anonymisation.md`](decisions/0026-account-deletion-anonymisation.md)                 | Account Deletion: Anonymise the User Row, Decide the Owned Workspace in the Flow                         |
| [`0027-attachment-quotas.md`](decisions/0027-attachment-quotas.md)                                           | Attachment Storage Quotas: Soft Byte Ceilings per Workspace and per Instance                             |
| [`0028-open-contributions-hosted-service.md`](decisions/0028-open-contributions-hosted-service.md)           | Open Contributions Under AGPL-3.0, No CLA; Revenue Only From a Hosted Service                            |

---

## 11. Security headers

Both processes set a fixed set of hardening headers on every response — `apps/api` via
`helmet` (`apps/api/src/common/configure-app.ts`), `apps/web` via Next's `headers()`
(`apps/web/next.config.ts`, backed by `apps/web/lib/security-headers.ts` so a vitest suite can
assert on the real source). They are configured separately rather than sharing one policy
object, because they are not the same kind of process: the API answers only JSON and is never
rendered, the web app is the browser surface that actually executes script and paints a page.

| Header                      | `apps/api`                                                                                                         | `apps/web`                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | `default-src 'none'` — an API renders nothing, so nothing is allowed to load, frame, or set a `<base>`/form target | `default-src 'self'`; `script-src`/`style-src` add `'unsafe-inline'` (App Router hydration + `next-themes` inline script, and Radix/`@dnd-kit` inline `style` attributes — see `lib/security-headers.ts` for why a nonce was not used and how `'unsafe-inline'` was verified necessary); `connect-src` names the API's `http(s)` origin and its derived `ws(s)` origin, because `lib/socket.ts` dials both |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                                                              | Same value. Both are inert on plain HTTP — browsers ignore the header outside HTTPS — so it costs nothing in local/dev and only takes effect once a deployment terminates TLS in front of the process                                                                                                                                                                                                      |
| `X-Frame-Options`           | `DENY`                                                                                                             | `DENY`, backed by CSP `frame-ancestors 'none'` for browsers that honour CSP over the legacy header                                                                                                                                                                                                                                                                                                         |
| `X-Content-Type-Options`    | `nosniff`                                                                                                          | `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Referrer-Policy`           | `no-referrer` (helmet's default, left unchanged — the API is never a navigation target)                            | `strict-origin-when-cross-origin` — same-origin navigation keeps the full path, cross-origin gets only the origin, and a downgrade to plain HTTP gets nothing                                                                                                                                                                                                                                              |
| `Permissions-Policy`        | Not set — a JSON API has no page context for a browser feature-permission policy to govern                         | Denies `camera`, `microphone`, `geolocation`, `payment`, `usb`, and `interest-cohort` (the FLoC/Topics-API opt-out) — none of which any board, task, or dashboard view ever requests                                                                                                                                                                                                                       |

`Cross-Origin-Resource-Policy` on the API is `cross-origin` rather than helmet's default
`same-origin`, because the web app may be a separate origin
(`WEB_URL`/`NEXT_PUBLIC_API_URL`) that legitimately reads it; that access stays gated by the
CORS allowlist in `configure-app.ts`, not by CORP.

**The Docker deployment is same-origin.** A reverse proxy (`docker/Caddyfile`) serves the web
app and the API from one hostname — `/auth/*` and `/api/*` reach the API, everything else the
web app — so browser requests are no longer cross-origin at all, and the web bundle can carry
a relative API base (`/api`) instead of a hostname compiled in at build time. That is what lets
one published image run on any domain (audit finding PM-02, `apps/web/lib/api-url.ts`,
[self-hosting.md](self-hosting.md)). The cross-origin machinery above stays in place: the dev
loop still runs the two apps on separate ports, and a deployment may still put the API on its
own hostname.

Related: [tech-stack.md](tech-stack.md) · [docs/README.md](README.md) (docs map)
