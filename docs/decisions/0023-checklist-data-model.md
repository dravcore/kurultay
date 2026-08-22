# 0023. Checklist Data Model: Multi-List Per Card, Derived Progress, No New Realtime Event

**Status:** Accepted
**Date:** 2026-08-14

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0023-checklist-data-model.md)

## Context

Kurul's schema carries no trace of `checklist` or `subtask`. The ROADMAP item that closes
this gap is titled "Checklist / subtask", and the two words hide a fork: a checklist item is a
line with a checkbox, a subtask is its own card with its own column, assignee and drag-and-drop
semantics. Building both in one pass would touch board DnD as much as the task panel, and the
scheduled window for this item is six days. A data model that quietly tried to serve both would
under-serve the one this window can actually ship.

The competitive pressure is specific, not general. [ROADMAP.md](../../ROADMAP.md)'s Beyond MVP
section and the audit that scheduled Phase 3 agree on the same three questions a team asks before migrating
a board off Trello: can I bring my boards, can I put files on cards, do I have checklists. The
next item on the same roadmap, Trello import, answers the first question — and a Trello board's
checklist is itself multi-list: a card can carry several named checklists, each with its own
items. Any model this ADR picks has to survive being the import target for that shape, because
choosing a single-level model now and discovering the mismatch during import work would mean
either flattening incoming data (silent loss) or a schema migration mid-Phase-3.

Two more constraints came from code already in the module, not from a fresh design. First,
`TaskLabelService` is the established shape for a task sub-resource: a task read resolves the
tenant, the mutation rides the Prisma relation, and the response is whatever `TaskEventsService`
re-reads. `packages/shared-types/src/socket.ts` states the realtime contract this shape depends
on in its own header comment — "Full DTOs are fetched over REST when the client needs richer
data" — so every socket event this codebase emits is a thin `{ taskId, ... }` pointer, never a
payload. Second, `apps/api/src/task/task.include.ts` today exports one `taskInclude` shared by
the board's list query and the single-task read, and P2-8 (issue FE-03) spent real effort
trimming what the list query fetches after measuring the board's cost with a full task shape per
card — main-thread busy time 34.1%, zero long tasks, 2.6 ms per pointer-move frame, 3,854 DOM
nodes. A checklist model that pulls full item rows into the list query undoes that work by
construction, before a single checklist even has ten items.

This same decision was going to be made twice regardless: the phase-3 plan (now folded into
[ROADMAP.md](../../ROADMAP.md)) already noted that attachments (P3-1) needs the same realtime
call — new event type, or ride `task:updated` — and deferred it to whichever of the two ships the
decision first. This ADR is that first decision.

## Decision

**Multi-list per card, Trello-shaped.** A task has zero or more `Checklist` rows, each with its
own `title` and `position`; each checklist has zero or more `ChecklistItem` rows, each with
`content`, `isDone` and its own `position`. Both position fields are `Float`, following
`Column.position` and `Task.position`, and both use the existing `POSITION_GAP` /
`midpoint()` helpers in `apps/api/src/common/position/fractional-index.ts` — no new positioning
scheme.

```prisma
model Checklist {
  id        String   @id @default(uuid(7))
  taskId    String
  title     String
  position  Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  task  Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  items ChecklistItem[]

  @@index([taskId, position])
}

model ChecklistItem {
  id          String   @id @default(uuid(7))
  checklistId String
  content     String
  isDone      Boolean  @default(false)
  position    Float
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  checklist Checklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)

  @@index([checklistId, position])
}
```

Both models cascade from `Task`; neither carries a foreign key to `User`.

**No new socket event.** A checklist mutation calls `TaskEventsService.emitUpdated`, exactly as
`TaskLabelService.addLabel` and `.removeLabel` do today, and the client re-reads the task over
REST. `SocketEvents.TASK_UPDATED` gains no new fields for this feature. P3-1 (attachments)
inherits this decision rather than re-deciding it.

**The list query and the detail query carry different checklist shapes.** The board list needs
one number per card — how many items, how many done — so its include projects
`{ items: { select: { isDone: true } } }`: one boolean per item, nothing else. The task panel
needs the full checklist tree in position order, so its include carries complete `ChecklistItem`
rows. `task.include.ts` grows two named includes (`taskListInclude`, `taskDetailInclude`) in
place of the single `taskInclude` both queries share today; `TaskDto.checklists` is `null` on a
list read and populated on a single-task read, alongside a `checklistSummary: { total, done }`
that is present on both.

**Completion percentage is counted at read time, from whichever checklist shape is loaded on
that request — never stored.** No `Task.checklistProgress` column, no per-checklist counter.

**Out of scope, each with what would reopen it:**

- **`ChecklistItem.completedById` / `.completedAt`.** Recording who checked an item adds a
  `User` foreign key this feature does not otherwise need, which is a direct cost against
  ADR-to-come P3-4 (account anonymization) — every FK to `User` is a row that anonymization has
  to reason about. Reopens when a real request for "who marked this done" arrives, not before.
- **Item assignee or item due date.** Either field starts turning a checklist item into a
  subtask by another name, and Phase 3 planning already closed that door for this window (see
  Consequences).
- **Checklist templates.** Reusing a checklist across cards is close to what Trello import
  (P3-3, the very next roadmap item) already does — importing a board's checklists onto its
  cards satisfies most of the same need a template would, so building both in the same phase is
  redundant until import ships and templates are asked for anyway.
- **Subtasks** — a task with its own card, column and assignee — are a different data model
  entirely, not a deeper checklist. This ADR implements checklist only. The ROADMAP line item
  this ADR closes is titled "Checklist / subtask"; that title should be corrected to "Checklist"
  once this phase lands, since subtask was never on this window's plan.

## Rationale

**Why multi-list over single-level.** A single `ChecklistItem[]` directly on `Task` is the
smaller schema and would have been the faster patch. It was rejected because Trello import
(P3-3), the very next roadmap item, imports a source model that is itself multi-list — a Trello
card can carry several named checklists. Importing that shape into a single-level model means
flattening on arrival: silent data loss, discovered only when a user compares their old board to
the new one. Modeling `Checklist` as a first-class row means the importer maps Trello checklists
onto Kurul checklists one-to-one and nothing is thrown away.

**Why no new socket event.** Two prior decisions already answer this one. `TaskLabelService`
established the sub-resource pattern used everywhere else on a task: resolve the tenant through
`TaskReadService`, mutate through the relation, respond with whatever
`TaskEventsService.emitUpdated` re-reads. And `packages/shared-types/src/socket.ts` states the
realtime contract in its own header — sockets carry thin pointers, REST carries data. A
`checklist:item-toggled` event would be the first checklist-specific payload in a system that
otherwise emits nothing but `{ taskId }`, and every future change to what a checklist item looks
like would then need to update two contracts instead of one. Emitting `TASK_UPDATED` also lets a
checklist mutation participate for free in everything already built around that event —
batching, board-scoped rooms, the client's re-fetch-on-update path — rather than needing a
second one built to match.

**Why the list query and detail query diverge.** `task.include.ts` exporting a single
`taskInclude` was fine while every relation on it was small. Checklists are not: a card can
accumulate dozens of items across several lists, and the board list renders every card at once.
Fetching full item rows — `content` strings, timestamps, position floats — for every item on
every card, on every board load, is exactly the per-card payload weight P2-8 spent a dedicated
performance pass removing. The board only ever renders a count for its progress badge; loading
full text to compute a count the server can pre-count is waste with no payoff. Projecting to
`{ isDone: true }` costs one boolean per item instead of a full row.

**Why completion percentage is derived, not stored.** A `Task.checklistProgress` counter is one
`INSERT`/`UPDATE`/`DELETE` on `ChecklistItem` away from disagreeing with the items it claims to
summarize — the moment a delete path forgets to decrement it, or a bulk operation bypasses the
one path that maintains it, the board badge lies about a specific card until someone notices.
Counting `done`/`total` from the loaded items at read time cannot drift, because there is nothing
to drift from: the read is the only time. The list query already pays for loading `{ isDone:
true }` per item; folding those booleans into `{ total, done }` is a loop over data already in
memory, not an additional query.

**Why subtask is out of scope even though the roadmap title names it.** A subtask with its own
board position, column and drag target is a second task model layered on the first — it inherits
every rule already enforced for `Task` (fractional position, column category transitions,
workspace scoping, assignee permissions) and would need its own decisions about most of them. A
checklist item has none of that: a string and a boolean inside a parent it can never leave.
Treating the two as one feature meant either building the lighter one with unused hooks for the
heavier one, or building the heavier one in a six-day window sized for the lighter one. The
roadmap title is a naming leftover from before this distinction was drawn, not a scope
commitment; it is corrected at phase close so a future reader does not go looking for subtask
code that was never planned.

## Consequences

**Easier.** The checklist surface reuses every mechanism already proven for a task sub-resource:
tenant scoping through the relation, fractional positioning through the existing helpers,
realtime through the existing event. There is no new authorization boundary to design, no new
socket payload to version, and no new positioning algorithm to test — Görev 6 of the
implementation plan tests the existing concurrent-append race, not a new one. Trello import
(P3-3) gets a checklist target that matches its source shape one-to-one. P3-1 (attachments)
inherits the "no new socket event" call outright instead of re-litigating it.

**Harder.** `task.include.ts` and `task.mapper.ts` stop being a single code path shared by every
task read; a future field that needs to differ between list and detail views now has a place to
go, but also a decision to make each time, where before there was none. `TaskDto.checklists`
being `null` on list reads and populated on detail reads is a shape every consumer of `TaskDto`
has to be aware of — a naive client reading `task.checklists.length` without checking which read
produced the object will crash on a list row. Completion percentage being derived rather than
stored means every read that needs it pays a small aggregation cost instead of a column lookup —
today a loop over an already-loaded array, not a query, but a cost a stored counter would not
have.

**What ships less than the roadmap title implied.** Nobody gets a subtask with its own card in
this phase. A team that read "Checklist / subtask" and expected the latter gets a checkbox list
instead; the roadmap correction at phase close is what keeps that expectation from recurring.

**What the deferred fields cost when their trigger fires.** Adding `completedById` /
`completedAt` later is an additive migration plus a new `User` foreign key to carry through
whatever P3-4's anonymization design turns out to be — cheap today, because that design does not
exist yet; expensive after, because anonymization will already have a fixed shape this field
would need to fit. Adding checklist templates later is a new model plus a "materialize this
template onto a card" mutation, additive to rather than a redesign of the two models above.

## Alternatives considered

| Alternative                                                     | Why not                                                                                                                                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single-level `ChecklistItem[]` directly on `Task`               | Trello's own checklist model is multi-list; importing it into a flat model loses structure on the first import anyone runs                                                                   |
| A new socket event per checklist mutation (`checklist:updated`) | A checklist-specific payload contradicts `socket.ts`'s own stated contract — thin pointers over sockets, DTOs over REST — and adds a second contract every future field change has to update |
| Denormalized `Task.checklistProgress` counter                   | Drifts from its items the first time a delete or bulk operation misses the one path that maintains it; a board badge that can silently lie is worse than one extra count-at-read-time loop   |
| Load full checklist items in the board list query               | Reverses the per-card payload reduction P2-8 measured and shipped, for data (item text, timestamps) the board never renders                                                                  |
| Implement subtask alongside checklist, per the ROADMAP title    | A subtask is a second task model — its own position, column, assignee — not a deeper checklist; building both does not fit the six-day window and Phase 3 planning already scoped it out     |
| Store `completedById` / `completedAt` on `ChecklistItem`        | Adds a `User` foreign key that only grows the surface P3-4 (account anonymization) has to reason about, for a question ("who checked this") nobody has asked yet                             |
| Checklist templates reusable across cards                       | Trello import (P3-3), the very next roadmap item, satisfies most of the same need by importing existing checklists onto their cards                                                          |
