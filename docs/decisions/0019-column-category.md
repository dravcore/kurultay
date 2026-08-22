# 0019. Column Completion Is a Category, Not a Name

**Status:** Accepted
**Date:** 2026-08-12
**Updated:** 2026-08-21: the Consequences section's note that `dashboard.service.ts`'s move to
`category: 'COMPLETED'` "waits until the current `perf/api-scale-debt` branch lands" is no longer
current: `Column.category` shipped (`schema.prisma`, `dashboard.service.ts`), and the web exposes
it in `column-settings-dialog.tsx`, as the same section already noted.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0019-column-category.md)

## Context

Dashboard completion and throughput metrics currently identify the "done" column by matching
its name. `apps/api/src/common/board-defaults.ts` exports the vocabulary that makes this work:

```ts
export const DONE_COLUMN_NAME = 'Done';
export const DONE_COLUMN_NAME_NORMALIZED = DONE_COLUMN_NAME.toLowerCase();
export const doneColumnNameFilter = { equals: DONE_COLUMN_NAME, mode: 'insensitive' } as const;
```

The docstring in that file is candid about why the matching is loose — "users rename and
re-case their columns freely" — but loose matching does not survive a rename to a different
word. A user who renames "Done" to "Shipped", "Complete", or "Released" silently zeroes their
completion metrics. Nothing errors and nothing warns; the dashboard simply reports no
completed work. This is a live defect today, not a hypothetical one.

[ADR 0018](0018-localization-strategy.md) turns the occasional bug into a guaranteed one: it
decides that default column names are seeded in the creator's locale, so a board created by a
Turkish user starts with `Bitti` and never matches `'done'` at all.

The name is the wrong carrier for this meaning. What the metrics need is a stable, structural
signal that survives renaming, translation, and user-created columns.

## Decision

Add a `ColumnCategory` enum to `Column`, separate from and independent of `name`:

```prisma
enum ColumnCategory {
  BACKLOG
  UNSTARTED
  STARTED
  COMPLETED
  CANCELED
}

model Column {
  // ...
  category ColumnCategory @default(UNSTARTED)
}
```

- Metrics key off `category`, never off `name`. `DONE_COLUMN_NAME`,
  `DONE_COLUMN_NAME_NORMALIZED` and `doneColumnNameFilter` are removed.
- Seed columns carry an explicit category: `To Do → UNSTARTED`, `In Progress → STARTED`,
  `Done → COMPLETED`.
- The migration backfills `COMPLETED` where `lower(name) = 'done'` and leaves every other
  column at the default.
- `category` is user-editable through column settings. It is a property of the column, not
  something derived from position or name.
- Only `COMPLETED` is consumed today. The other four values are vocabulary the metrics layer
  will grow into.

## Rationale

- Every mature tool in this category separates the displayed name from the semantic state.
  Jira has a Status Category (To Do / In Progress / Done), Linear gives each workflow state a
  type (`backlog`, `unstarted`, `started`, `completed`, `canceled`), and Azure DevOps has a
  State Category. None of them kept name matching. Converging independently on the same shape
  is a strong signal that it is the right one.
- Linear's five-value set is adopted rather than a boolean `isDone` because **a canceled task
  is not a completed one**. Counted as done it inflates throughput; counted as open it leaves
  the column permanently unfinished. A boolean cannot express the difference, and adding it
  later means a second migration and a second backfill — at exactly the cost of doing it now.
- `CANCELED` is included today for that reason even though nothing reads it yet. The other
  values cost one enum entry each.
- The default is `UNSTARTED` rather than `BACKLOG` so a newly created column is treated as
  active work in progress terms, which matches how people use a fresh column.

## Consequences

- A schema migration with a backfill, plus `category` added to the `Column` DTO and to
  `packages/shared-types`.
- `dashboard.service.ts` completion queries move to `category: 'COMPLETED'`. This overlaps
  work already in flight on that file, so implementation waits until the current
  `perf/api-scale-debt` branch lands.
- The name constants go away and `DEFAULT_COLUMNS` carries a category per seed column. Note
  that `refactor/web-dedupe` moved `DEFAULT_COLUMNS` and `DONE_COLUMN_NAME` into
  `packages/shared-types/src/board-defaults.ts`, leaving only the Prisma-shaped
  `DONE_COLUMN_NAME_NORMALIZED` and `doneColumnNameFilter` in
  `apps/api/src/common/board-defaults.ts`. Both halves are affected: the shared package gains
  the per-column category, the API half is deleted outright.
  _Since superseded:_ implementing ADR 0018 moved the seed list back to
  `apps/api/src/common/board-defaults.ts` as `defaultColumnsFor(locale)`, once the web stopped
  seeding columns itself. The category still travels with each seed column; only its home
  changed.
- **The web exposes column category in column settings** — otherwise a user's own "Shipped"
  column can never count as done. Shipped in `column-settings-dialog.tsx`.
- A board may legitimately have more than one `COMPLETED` column (for example "Shipped" and
  "Won't Do" split apart later). Metrics must treat completion as a set of columns, not a
  single row. The old name matching had the same property via `mode: 'insensitive'`, so this is
  not new, but it now has to be deliberate.
- Existing boards whose done column was already renamed will still report zero completions
  until someone sets the category. The backfill cannot recover intent from an arbitrary name.
  A one-time note in the release changelog is warranted.
- Future work gets a stable hook: board templates, WIP limits, cycle-time measurement, and
  automation rules can all key off category instead of re-inventing a name convention.

## Alternatives considered

| Alternative                                      | Why not                                                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Boolean `isDone`                                 | Cannot distinguish canceled from completed; that distinction costs a second migration later at the same price as doing it now          |
| Keep name matching, add per-locale synonym lists | Every new language extends the list, and a plain user rename still kills the metric — the actual defect survives untouched             |
| Derive from position (last column is done)       | Boards legitimately end with a "Blocked", "Archive", or "Won't Do" column, and reordering would silently change what "completed" means |
| A separate `BoardSettings.doneColumnId` pointer  | Handles one column per board, breaks when completion splits across two, and adds a referential-integrity edge case on column delete    |
| Free-text `category` string instead of an enum   | Reintroduces exactly the matching problem this ADR removes, one layer down                                                             |
