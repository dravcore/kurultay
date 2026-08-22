# 0003. Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-08-08 — the @dnd-kit rationale was contradicted by the registry and has been rewritten honestly; the Recharts bundle figure was unsourced and is replaced by its dependency surface.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0003-frontend-stack.md)

## Context

The frontend must render an interactive kanban board (drag-and-drop reordering),
a styled component system, and a dashboard with charts, while staying
lightweight enough for a solo/small-team codebase to maintain.

## Decision

**Next.js 16 (App Router)** + **Tailwind CSS** + **shadcn/ui** + **@dnd-kit** +
**Recharts**.

## Rationale

- `react-beautiful-dnd` is deprecated — Atlassian withdrew from maintaining it,
  so it is not a viable pick for new work.
- **@dnd-kit, classic line** (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable`
  10.0.0). MIT, ~6 KB core, accessible (keyboard and screen-reader support),
  framework-agnostic, and the most widely deployed React drag-and-drop library.
- **Recorded deliberately: this line is frozen, not actively maintained.** The
  classic packages have shipped no release since December 2024, and the
  documentation-site repository was archived in February 2026. Maintainer
  effort has moved to a next-generation rewrite (`@dnd-kit/react`), which is
  still pre-1.0 with a different API and is **not** being adopted here. A
  frozen library is not a broken one — for a 50–200-card board, "no releases"
  plausibly means "done" — but the decision is made with that known, not in
  spite of it.
- **The alternative is actively maintained, and it still loses.** Atlassian's
  `pragmatic-drag-and-drop` (2.0.x, Apache-2.0) ships regularly, but it
  requires hand-writing collision detection, and its v2 landed with thin
  upgrade documentation. For a solo maintainer, a stable dependency with no
  upgrade churn is worth more than an actively released one that costs custom
  collision code; the pinned-and-frozen risk is a bug we cannot work around,
  which is a smaller and more visible risk than a permanent maintenance tax.
- Versions are **pinned exactly** (no `^`), since "latest" carries no fixes.
- **Recharts** is the safest default for most React dashboards: strong ecosystem
  adoption, an understandable component API, SVG rendering, good fit with
  shadcn/ui, MIT-licensed. It is not the lightest option, and the real cost is
  its dependency surface rather than a byte count: v3 declares
  `@reduxjs/toolkit`, `react-redux`, `immer`, and `victory-vendor` (d3) as
  runtime dependencies, so it pulls Redux Toolkit into an app that otherwise
  has no state library. If the chart count grows, a bundle budget tightens, or
  that graph conflicts with app-level state choices, a Canvas-based library
  (Chart.js, Apache ECharts) should be reconsidered.

## Consequences

- Accessible drag-and-drop out of the box, without building keyboard support
  ourselves.
- Consistent visual language via Tailwind + shadcn/ui reduces one-off styling.
- Ships dashboards quickly with Recharts' straightforward API.
- `@dnd-kit`'s collision detection may need custom tuning as board interactions
  grow more complex (nested sortables, multi-column drag) — and no upstream fix
  is coming for the classic line, so any tuning is ours to own.
- A `@dnd-kit` bug we cannot work around is the failure mode this decision
  accepts. **Re-evaluation trigger: at Phase 4**
  (the MVP roadmap's Phase 4; its checklist now lives only in git history), when the board
  interaction is actually built, or earlier if such a bug appears or if
  `@dnd-kit/react` reaches 1.0. The migration target is
  `pragmatic-drag-and-drop`, costed at "write collision detection", not at
  "rearchitect the board".
- **Phase 4 re-evaluation (2026-08-09):** classic `@dnd-kit` shipped the
  multi-column board (`PointerSensor` + `KeyboardSensor`, `closestCorners`,
  per-column `SortableContext`, optimistic move + toast rollback). No blocker
  appeared; **keep the pinned classic line**. Revisit only if a frozen-line
  bug blocks a later board interaction or `@dnd-kit/react` reaches 1.0 with a
  clear migration path.
- Recharts' dependency surface will need revisiting once analytics features
  expand — this is a deliberate "revisit later" trade-off, not an oversight.

## Alternatives considered

| Alternative               | Why not                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| react-beautiful-dnd       | Deprecated; Atlassian withdrew maintenance                                                                                                                                                                               |
| pragmatic-drag-and-drop   | Actively maintained (2.0.x, Apache-2.0) and the designated fallback, but requires hand-written collision detection and shipped v2 with thin upgrade documentation — a permanent cost accepted only if @dnd-kit blocks us |
| Chart.js / Apache ECharts | Canvas-based, better for very large datasets, but heavier integration and less idiomatic with shadcn/ui right now                                                                                                        |
