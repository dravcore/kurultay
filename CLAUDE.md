# Kurul

Open-source Kanban-focused project management tool. `dravcore/kurul` — AGPL-3.0.

## Architecture

- Monorepo (pnpm workspace) + **modular monolith** — no microservices
- `apps/api` (NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8 + Socket.io)
- `apps/web` (Next.js 16 App Router + Tailwind + shadcn/ui + @dnd-kit + Recharts)
- `packages/shared-types` (TS types shared between frontend/backend — DTOs, enums, socket events)
- `packages/auth-access` (Better Auth organization access-control roles for api + web)
- Auth: Better Auth (organization plugin; product domain = Workspace) · Deploy: Docker Compose

## Critical rules

- `Task.position` and `Column.position` are **Float** (fractional indexing) — never use Int
- `dueDate` and `estimatedMinutes` are separate fields — do not merge them
- `priority` is kept separate from labels
- Multi-tenant isolation: every query is scoped by `workspaceId`, enforced at guard/interceptor level
- Every `id` is UUIDv7 (`@default(uuid(7))`) — never cuid or autoincrement; pagination cursors key on `id`, never on `position`
- `Label.color` stores a theme-resolved design-token slot name (`slot-1`…`slot-8`), never a raw hex

## Git

- **Git Flow:** `main` (releases) ← `develop` (integration) ← `feature/*`, `fix/*`, `docs/*`, `chore/*`, plus `release/*`, `hotfix/*`
- **Conventional Commits** (`feat:`, `fix:`, `docs:` ...) · SemVer + `CHANGELOG.md`
- No direct commits to `main` or `develop` — all work goes through feature branch + PR
- **No AI attribution anywhere:** no `Co-Authored-By: Claude/Cursor/…` trailer in commits, no
  `🤖 Generated with …` footer in PR bodies, issues, comments, CHANGELOG, or docs. Write the
  message body and stop.

## Documentation

- English is canonical; Turkish copies live under `docs/tr/`; root has `README.md` + `README.tr.md`
- Naming: root community files UPPERCASE, `docs/` files kebab-case, ADRs `NNNN-title.md`
- Architecture/stack details: `docs/architecture.md`, `docs/tech-stack.md`, `docs/design.md` (UI/UX language)
- Process: `docs/git-strategy.md`, `docs/coding-standards.md`, `docs/testing.md`, `docs/api-conventions.md`
- Docs map: `docs/README.md` · Decisions: `docs/decisions/` · Progress: `ROADMAP.md`

## Docs policy

- Update the existing canonical file before creating any new `.md`; a new file is only for a
  new _kind_ of record (in practice: a new ADR)
- One fact lives in one canonical file — link to it from elsewhere, never copy it
- Roadmap has a single source: root `ROADMAP.md`. There is no archive: a finished plan or spec
  is deleted, git history keeps it, and its lasting outcome lives in `ROADMAP.md` or an ADR
- Working notes and audit dashboards stay out of the repo; distill lasting outcomes into
  `ROADMAP.md` items instead
- A PR that changes a `docs/` file updates its `docs/tr/` mirror in the same PR
