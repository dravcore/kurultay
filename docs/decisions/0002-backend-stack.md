# 0002. Backend Stack: NestJS + Prisma + PostgreSQL + Redis

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-08-08 — records Prisma 7's breaking changes, and pins PostgreSQL 18 / Redis 8 with the licensing reason.
**Updated:** 2026-08-18 — "HTTP rate limiting is not wired yet" (Rationale, below) is stale. A
global `ThrottlerModule` + `ThrottlerGuard` (`apps/api/src/app.module.ts`) now bounds every HTTP
request, and Better Auth carries a second, Redis-backed limiter of its own on top for its own
routes (`apps/api/src/auth/auth-rate-limit.ts`) — since #277, that one degrades to a bounded
per-process in-memory counter on a Redis error rather than failing open (audit finding SEC-03).
The nuance that survives: the Nest `ThrottlerModule` itself still does not use Redis — its
counters are the library's default in-memory store, so only Better Auth's own limiter is a Redis
job, not the API's general-purpose one.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0002-backend-stack.md)

## Context

The backend needs a framework, ORM, database, and cache/queue layer that fit a
solo/small-team build of a realtime-leaning, multi-tenant kanban tool, and that
share types cleanly with the Next.js frontend.

## Decision

**NestJS 11 + TypeScript**, **Prisma 7** as ORM, **PostgreSQL 18**, and **Redis 8**.

## Rationale

- Industry precedent: ClickUp runs TypeScript/NestJS/PostgreSQL/Redis (plus Kafka
  at its scale); Linear runs end-to-end Node.js/TypeScript with PostgreSQL and
  Redis as its event bus and cache.
- NestJS's modular architecture keeps a multi-module product (auth, workspace,
  board, task, dashboard, notification) organized for a solo developer or small
  team.
- Same language as the frontend enables `packages/shared-types` — task/board
  types defined once and consumed by both sides, saving real time whenever the
  data model changes.
- Most OSS PM alternatives (Plane, Taiga) use Django for fast CRUD and a free
  admin panel; end-to-end TypeScript becomes the stronger choice once realtime
  sync is a priority, which it is here.
- **Prisma over Drizzle:** both are production-ready in 2026. Drizzle offers
  SQL-close control and the smallest footprint (~7.4kb); Prisma offers a
  schema-first workflow, a mature ecosystem, and rich tooling (Prisma Studio).
  Prisma 7 dropped its Rust engine dependency, largely resolving the historical
  bundle-size complaint. Prisma's guided migrations and thorough docs save
  debugging time working solo — Drizzle's performance edge lives in the ORM
  layer, and in practice the DB round-trip (5–50ms) dwarfs that difference.
- **Postgres + Redis** is close to undisputed: both commercial peers (ClickUp,
  Linear) and OSS peers (Plane, Taiga, Focalboard) use Postgres — JSON fields
  cover flexible metadata (custom fields), relational integrity covers
  task/board relations. Redis covers the Socket.io pub/sub adapter and the BullMQ
  due-soon notification queue. Sessions live in PostgreSQL (Better Auth); HTTP rate
  limiting is not wired yet — those two were anticipated Redis jobs at decision time and
  are not current runtime uses.
- **PostgreSQL 18, the current major.** Pinning the previous major would be
  supportable for years, but silently: a greenfield project has no reason to
  start one version behind. The deadline matters more than the version — the
  official `postgres` image refuses to start against a `PGDATA` volume
  initialized by a different major, so every major bump after v0.1 ships is a
  `pg_dump`/restore chore for every self-hoster. Done now, it costs nothing.
  PostgreSQL 19 is in beta and deliberately skipped.
- **Redis 8, for the licence.** Redis 7.4–7.8 are RSALv2/SSPLv1 only —
  source-available, not OSI open source. Redis 8 restored an OSI-approved
  option, **AGPLv3**, which is the licence Kurul itself ships under (see
  [0007](0007-license-agpl.md)), so the stack a self-hoster pulls is
  licence-aligned end to end. Valkey (BSD-3-Clause, the Linux Foundation fork
  of Redis 7.2.4) is protocol-compatible and remains a one-line image change
  if a permissive licence is ever needed downstream. Unlike the Postgres pin,
  Redis 7 → 8 is an in-place, RDB/AOF-compatible upgrade with no deadline
  attached.

## Consequences

- Guided migrations and strong docs reduce solo-dev debugging time; Prisma
  Studio speeds up local inspection.
- **Prisma 7 is not a free upgrade, and its breaking changes shape the
  skeleton rather than being discovered during it:**
  - A **driver adapter is mandatory** — `@prisma/adapter-pg` for PostgreSQL.
    `PrismaService` therefore owns a `pg` Pool's lifecycle in
    `OnModuleInit`/`OnModuleDestroy`, not merely a connection string, which
    is a real consideration for the `api`/`ws`/`worker` process split in
    [architecture.md](../architecture.md#8-runtime-evolution).
  - A root **`prisma.config.ts`** replaces env-var configuration inside
    `schema.prisma`, and it owns the **seed entry point** — automatic seeding
    was removed, so `db:seed` is always explicit.
  - The generator **`output` path is required** and must sit outside
    `node_modules`. The client emits to `apps/api/src/generated/prisma` for Nest
    and the Better Auth adapter. `@kurul/shared-types` DTOs/enums are
    hand-maintained against the schema today; mechanical Prisma→shared-types
    codegen remains aspirational.
  - **Client middleware (`$use`) is removed.** Query-level cross-cutting
    guards — the `workspaceId` scoping helper of
    [architecture.md §7](../architecture.md#7-multi-tenant-isolation), a
    compare-and-swap guard on `Task.position` — must be built as **Client
    Extensions**. There is no middleware layer to fall back to.
  - **Env vars are not auto-loaded**; `dotenv` is called explicitly.
  - Minimum Node 20.19.0 and TypeScript 5.4 follow from the above (Prisma’s documented
    floor at acceptance). The **repository engines field** is stricter today:
    `"node": ">=24"` in the root `package.json` — see [development.md](../development.md).
- Redis becomes a hard runtime dependency for basic features, not an optional
  extra.
- Prisma's schema-first flow is less flexible than raw SQL for complex queries
  when they eventually arise.
- Committing to end-to-end TypeScript forgoes Django's batteries-included admin
  panel that OSS peers get for free.

## Alternatives considered

| Alternative | Why not                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Fastify     | Lighter, but lacks Nest's built-in modular DI structure — more to hand-roll for a multi-module product                                      |
| Django      | Fast CRUD + free admin panel (why Plane, Taiga chose it), but breaks end-to-end TS type sharing and fits a realtime-heavy product less well |
| Drizzle     | Smaller footprint, closer to SQL, but less guided migration tooling for solo development                                                    |
