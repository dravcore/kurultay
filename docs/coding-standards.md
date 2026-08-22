# Coding Standards

Conventions for TypeScript, NestJS, and Next.js code in this repository.

> 🌐 English (canonical) | [Türkçe](tr/coding-standards.md)

## Contents

- [Principles](#principles)
- [TypeScript](#typescript)
- [Naming conventions](#naming-conventions)
- [NestJS (`apps/api`)](#nestjs-appsapi)
- [DTOs and validation](#dtos-and-validation)
- [Next.js (`apps/web`)](#nextjs-appsweb)
- [Shared types (`packages/shared-types`)](#shared-types-packagesshared-types)
- [Imports](#imports)
- [Formatting and linting](#formatting-and-linting)

## Principles

1. **The linter is the source of truth for style.** Formatting is never discussed in code
   review. If a rule is worth having, it is worth encoding in ESLint or Prettier.
2. **Module boundaries are the architecture.** Kurul is a modular monolith; the only
   thing keeping it from becoming a mud ball is discipline about who may import whom.
3. **Types are declared once.** Anything crossing the API boundary lives in
   `@kurul/shared-types` and is imported, never re-typed.
4. **Explicit over clever.** Code is read far more often than written.

## TypeScript

- `strict: true` in **every** `tsconfig.json` — root, `apps/api`, `apps/web`,
  `packages/shared-types`. No package opts out.
- Also on: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.

| Rule                   |                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `any`                  | Forbidden. Use `unknown` and narrow, or write the type. `// eslint-disable` needs a comment explaining why.                             |
| Non-null assertion `!` | Avoid. Narrow the type or throw explicitly.                                                                                             |
| `as` casts             | Only for genuinely un-typeable boundaries (parsed JSON, third-party gaps), with a comment.                                              |
| Return types           | Explicit on exported functions and all public service/controller methods. Inferred is fine for local helpers.                           |
| `enum`                 | Prefer string-literal unions or `as const` objects; the Prisma-generated enums are the exception and are re-exported from shared types. |
| `interface` vs `type`  | `interface` for object shapes that may be extended, `type` for unions, intersections, and mapped types. Do not mix in the same concept. |
| `null` vs `undefined`  | `null` is a stored absence (a DB column), `undefined` is an absent value (an optional field). Do not use them interchangeably.          |

Errors are typed and thrown, never returned as `{ error: string }` from a service. The API
translates them into the response shape described in
[api-conventions.md](api-conventions.md#errors).

## Naming conventions

| Thing                                         | Convention                   | Example                                               |
| --------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| Files and directories                         | `kebab-case`                 | `task-position.service.ts`, `components/board/`       |
| Classes, decorators, types, interfaces, enums | `PascalCase`                 | `TaskService`, `CreateTaskDto`, `MemberRole`          |
| Functions, variables, methods, properties     | `camelCase`                  | `moveTask`, `workspaceId`                             |
| Constants (module-level, truly constant)      | `UPPER_SNAKE_CASE`           | `DEFAULT_PAGE_SIZE`, `POSITION_GAP`                   |
| React components                              | `PascalCase` file and export | `components/board/task-card.tsx` exporting `TaskCard` |
| React hooks                                   | `use` prefix, camelCase      | `use-board-socket.ts` exporting `useBoardSocket`      |
| Booleans                                      | `is` / `has` / `can` prefix  | `isArchived`, `hasUnreadComments`                     |
| Prisma models                                 | `PascalCase` singular        | `Task`, `WorkspaceMember`                             |
| Database-facing ids                           | `<entity>Id`                 | `workspaceId`, `boardId`                              |

File names are kebab-case even when the default export is `PascalCase` — the file system is
case-insensitive on macOS and case-sensitive in CI, and kebab-case avoids that entire class
of breakage.

### NestJS file suffixes

Every file in `apps/api` carries a suffix naming its role:

| Suffix             | Role                                  |
| ------------------ | ------------------------------------- |
| `*.module.ts`      | Nest module definition                |
| `*.controller.ts`  | HTTP route handlers                   |
| `*.service.ts`     | Business logic                        |
| `*.dto.ts`         | Request/response DTOs (inside `dto/`) |
| `*.guard.ts`       | Guards                                |
| `*.interceptor.ts` | Interceptors                          |
| `*.filter.ts`      | Exception filters                     |
| `*.decorator.ts`   | Custom decorators                     |
| `*.gateway.ts`     | Socket.io gateways                    |
| `*.spec.ts`        | Unit tests, colocated                 |

## NestJS (`apps/api`)

### Module skeleton

Every domain module has the same shape. No exceptions, even for a module with one endpoint.

```
src/task/
├── task.module.ts
├── task.controller.ts
├── task.service.ts
├── dto/
│   ├── create-task.dto.ts
│   ├── update-task.dto.ts
│   ├── move-task.dto.ts
│   └── task-response.dto.ts
└── task.service.spec.ts
```

| Layer      | Responsibility                                        | Must not                                                                             |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Controller | HTTP shape: routing, params, status codes, DTO in/out | Contain business logic or touch Prisma                                               |
| Service    | Business logic, transactions, Prisma access           | Know about HTTP (no `Request`, `Response`, no HTTP exceptions in pure logic helpers) |
| DTO        | The contract at the edge, with validation decorators  | Contain logic                                                                        |

### Module boundaries

**A module never imports another module's service directly.**

```ts
// Wrong — reaches past the module boundary
import { BoardService } from '../board/board.service';

// Right — depend on the module, inject what it exports
@Module({
  imports: [BoardModule],
  providers: [TaskService],
})
export class TaskModule {}
```

Rules:

- A module's public API is what its `@Module({ exports: [...] })` lists. Everything else is
  private to that module.
- Export the smallest surface that works. If only two methods are needed elsewhere, export
  a narrow facade rather than the whole service.
- Cross-module reads that would create a cycle are a design smell. Resolve them by moving
  the shared concern into `common/`, or by emitting an event, not by adding a back-import.
- `PrismaModule`, `common/`, and `AuthModule` are globally available (`@Global()`);
  feature modules still import what they need for clarity where the boundary matters.

This is what keeps the modular monolith extractable later — see
[architecture.md](architecture.md) and
[decisions/0001-monorepo-modular-monolith.md](decisions/0001-monorepo-modular-monolith.md).

### Multi-tenant isolation

Every query is scoped by `workspaceId`. `WorkspaceGuard` establishes membership; each
service method still filters Prisma with that `workspaceId` (or `board: { workspaceId }`).
A service method that takes a `boardId` without a `workspaceId` in scope is a bug, not a
shortcut.

> Request-scoped Prisma Client Extensions remain deferred. Isolation is enforced by
> review and by the workspace-isolation integration tests — not by a lint rule or an
> automatic query rewriter. Treat any query without workspace scoping as blocking in review.

## DTOs and validation

Validation happens **at the edge**, in DTOs, with `class-validator`. Services trust their
input; controllers do not.

```ts
// src/task/dto/create-task.dto.ts
export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;
}
```

- A global `ValidationPipe` runs with `whitelist: true`, `forbidNonWhitelisted: true`, and
  `transform: true`. Unknown properties are rejected, not silently dropped.
- `UpdateXDto` is derived: `export class UpdateTaskDto extends PartialType(CreateTaskDto) {}`.
- Ids in the path are validated too (`@IsUUID('7')` — every id is a UUIDv7, see
  [api-conventions.md](api-conventions.md#data-types)), never trusted raw.
- Response DTOs are explicit — never return a Prisma entity straight from a controller.
  Password hashes, internal flags, and soft-delete columns do not leak by accident when the
  response shape is declared.

DTO naming and the response/error format: [api-conventions.md](api-conventions.md).

## Next.js (`apps/web`)

- **App Router only.** No `pages/`.
- **Server Components by default.** Add `'use client'` only when the component needs state,
  effects, event handlers, or browser APIs — and push it as far down the tree as possible.
  A whole board page should not be a client component because one button needs `onClick`.
- Data fetching for initial render happens on the server; interactive mutations go through
  the typed client in `lib/api.ts`.
- Socket.io subscriptions live in client components, set up in a hook, torn down on unmount.

### Component organization

Components are organized **by domain**, not by type.

```
components/
├── ui/           # shadcn/ui primitives ONLY — generated, not hand-edited
├── board/        # kanban-board.tsx, board-column.tsx, task-card.tsx
├── task/         # task-detail-panel.tsx, task-priority-badge.tsx
├── dashboard/    # chart components
└── layout/       # sidebar, workspace switcher
```

| Rule                          |                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/`              | shadcn/ui output only. Do not put project components here, and do not hand-modify primitives beyond what the shadcn workflow produces.   |
| Domain folders                | Own their components; a board component belongs in `board/`, however small                                                               |
| `components/common/`          | Domain-free composites shared across domains — no DTOs, no API calls. `ConfirmDialog` / `FormDialog` live here, not in `ui/`             |
| Shared cross-domain component | Prefer keeping it local. Promote to `common/` when 3+ domains use it, or when 2 domains would otherwise duplicate a non-trivial skeleton |
| Page files                    | `page.tsx` composes components; it does not hold layout logic or markup of any size                                                      |

### Styling

- Tailwind utility classes in the markup; no CSS modules, no styled-components.
- Conditional classes go through the `cn()` helper, never string concatenation.
- Design tokens (colors, spacing, radius) come from the Tailwind theme — no arbitrary hex
  values in components.

## Shared types (`packages/shared-types`)

Anything that crosses the API boundary is declared **once**, in
`@kurul/shared-types`, and imported by both sides:

- DTO/response shapes
- Enums (`Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot`)
- Socket.io event names and payload types

Better Auth organization **access-control roles** live in `@kurul/auth-access`
(peer-depends on `better-auth`). Import roles from there — do not copy
`permissions` statements between `apps/api` and `apps/web`.

```ts
// Right
import type { TaskResponse, Priority } from '@kurul/shared-types';
import { ac, roles } from '@kurul/auth-access';

// Wrong — a redeclared shape that will silently drift
interface Task {
  id: string;
  title: string;
  priority: string;
}
```

Never redeclare, never duplicate, never "just add the one field locally". If the frontend
needs a shape the backend does not return, that is an API change, not a local type.

## Imports

Preferred order (convention; not currently machine-enforced by `eslint-plugin-import`):

```ts
// 1. Node builtins
import { randomUUID } from 'node:crypto';

// 2. External packages
import { Injectable, NotFoundException } from '@nestjs/common';

// 3. Workspace packages
import type { TaskResponse } from '@kurul/shared-types';

// 4. Absolute internal (path alias)
import { PrismaService } from '@/prisma/prisma.service';

// 5. Relative
import { CreateTaskDto } from './dto/create-task.dto';
```

- Use `import type` for type-only imports.
- Prefer the `@/` path alias over `../../..` chains beyond one level up.

### Barrel files

Use them sparingly.

- **Acceptable:** the single public entry point of `packages/shared-types` or
  `packages/auth-access`; a module's `dto/index.ts`.
- **Avoid:** barrels inside `apps/api` module folders and across `components/`. They create
  import cycles, defeat tree-shaking, slow down the TypeScript server, and make it easy to
  import past a module boundary without noticing.
- Never re-export a module's internals through a barrel to make cross-module imports
  convenient — that is the boundary rule being broken with extra steps.

## Formatting and linting

| Tool           | Role                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier       | All formatting. Config is committed; no editor-local overrides.                                                                                                                                                                                                                                                                                                                                                        |
| ESLint         | Flat config: `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, plus `apps/web` plugins (`eslint-plugin-react-hooks`, `@next/eslint-plugin-next`, `eslint-plugin-jsx-a11y` recommended). Nest and `eslint-plugin-import` are not wired — keep import order by convention. `jsx-a11y` still peers on eslint ^3–9; root `pnpm.peerDependencyRules.allowedVersions` allows eslint 10 until upstream catches up. |
| `tsc --noEmit` | Typecheck, run in CI separately from lint                                                                                                                                                                                                                                                                                                                                                                              |

```bash
pnpm lint          # ESLint check
pnpm lint --fix    # ESLint autofix
pnpm format        # Prettier write
pnpm format:check  # Prettier check (CI gate)
pnpm typecheck     # shared package builds + tsc --noEmit
```

- CI fails on lint errors, format drift (`format:check`), and type errors. Warnings are not
  allowed to accumulate: a rule is either an error or it is removed.
- **Style is not reviewed by humans.** If a reviewer wants a formatting change, the fix is a
  lint rule PR, not a review comment.
- Do not commit generated output (`dist/`, `.next/`, Prisma client) or disable rules
  file-wide without a comment explaining the reason.

## See also

- [architecture.md](architecture.md) — module map and layering
- [api-conventions.md](api-conventions.md) — REST, DTO naming, error format
- [testing.md](testing.md) — test placement and expectations
- [git-strategy.md](git-strategy.md) — commits and PR process
- [architecture.md](architecture.md#2-monorepo-layout) — directory layout these rules assume
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contribution process
