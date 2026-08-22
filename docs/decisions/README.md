# Architecture Decision Records

Lightweight, MADR-style records of the significant decisions behind Kurul.

> 🌐 English (canonical) | [Türkçe](../tr/decisions/README.md)

## Why ADRs

Kurul is built by a small team (often solo) before and during active
development. Decisions like "why Prisma over Drizzle" or "why AGPL" get made
once, with real trade-offs weighed, and then forgotten unless they're written
down. An ADR captures the context, the decision, and the reasoning at the
moment it was made, so a future contributor (including a future us) doesn't
have to reconstruct the reasoning from a Slack thread or reopen a settled
debate. These are intentionally short and factual, not design documents.

## Index

| #                                                      | Title                                                                                                    | Status                                                 | Date       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| [0001](0001-monorepo-modular-monolith.md)              | Monorepo + Modular Monolith                                                                              | Accepted                                               | 2026-08-08 |
| [0002](0002-backend-stack.md)                          | Backend Stack: NestJS + Prisma + PostgreSQL + Redis                                                      | Accepted                                               | 2026-08-08 |
| [0003](0003-frontend-stack.md)                         | Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts                                     | Accepted                                               | 2026-08-08 |
| [0004](0004-auth-better-auth.md)                       | Auth: Better Auth with Organization Plugin                                                               | Accepted                                               | 2026-08-08 |
| [0005](0005-realtime-socketio.md)                      | Realtime: Socket.io + Redis Adapter                                                                      | Accepted                                               | 2026-08-08 |
| [0006](0006-fractional-indexing.md)                    | Fractional Indexing for Task and Column Position                                                         | Accepted                                               | 2026-08-08 |
| [0007](0007-license-agpl.md)                           | License: AGPL-3.0                                                                                        | Accepted                                               | 2026-08-08 |
| [0008](0008-git-flow-semver.md)                        | Git Flow + Conventional Commits + SemVer                                                                 | Accepted                                               | 2026-08-08 |
| [0009](0009-board-column-permissions.md)               | Board and Column Permissions                                                                             | Accepted                                               | 2026-08-09 |
| [0010](0010-task-permissions.md)                       | Task Permissions                                                                                         | Accepted                                               | 2026-08-09 |
| [0011](0011-label-task-metadata-permissions.md)        | Label and Task-Metadata Permissions                                                                      | Accepted (comment-delete row superseded by 0012)       | 2026-08-09 |
| [0012](0012-comment-delete-authorship.md)              | Comment Delete Authorship                                                                                | Accepted                                               | 2026-08-09 |
| [0013](0013-invitation-email-verification.md)          | Invitation-Acceptance Email Verification                                                                 | Accepted                                               | 2026-08-10 |
| [0014](0014-dual-licensing-cla.md)                     | Dual Licensing and a Contributor License Agreement                                                       | Superseded by 0028                                     | 2026-08-11 |
| [0015](0015-no-external-contributions.md)              | No External Contributions; Legal Spend Deferred                                                          | Superseded by 0028                                     | 2026-08-12 |
| [0016](0016-foreign-key-violation-status.md)           | Foreign-Key Violations Map to 409, Not 422                                                               | Accepted                                               | 2026-08-12 |
| [0017](0017-partial-indexes-outside-prisma-schema.md)  | Partial Indexes Live in Migrations, Guarded by Tests                                                     | Accepted                                               | 2026-08-12 |
| [0018](0018-localization-strategy.md)                  | Localization Strategy: next-intl Without URL Routing                                                     | Accepted                                               | 2026-08-12 |
| [0019](0019-column-category.md)                        | Column Completion Is a Category, Not a Name                                                              | Accepted                                               | 2026-08-12 |
| [0020](0020-data-retention.md)                         | Data Retention: Per-Table Windows Enforced by a Nightly Sweep                                            | Accepted                                               | 2026-08-14 |
| [0021](0021-activation-funnel-and-opt-in-telemetry.md) | Activation Funnel In-Instance, Telemetry Opt-In and Off by Default                                       | Accepted                                               | 2026-08-14 |
| [0022](0022-attachment-storage.md)                     | Attachment Storage: Local Disk Behind a Port, Served From the API Origin                                 | Accepted (attachment kinds and limits settled in 0024) | 2026-08-14 |
| [0023](0023-checklist-data-model.md)                   | Checklist Data Model: Multi-List Per Card, Derived Progress, No New Realtime Event                       | Accepted                                               | 2026-08-14 |
| [0024](0024-attachment-kinds-and-serving-policy.md)    | Attachment Kinds and Serving Policy: FILE or LINK, One Size Number in Two Layers, Inline Only for Images | Accepted                                               | 2026-08-15 |
| [0025](0025-trello-import-mapping.md)                  | Trello Import Mapping: Nothing Is Guessed, Everything Missing Is Counted                                 | Accepted                                               | 2026-08-15 |
| [0026](0026-account-deletion-anonymisation.md)         | Account Deletion: Anonymise the User Row, Decide the Owned Workspace in the Flow                         | Accepted                                               | 2026-08-15 |
| [0027](0027-attachment-quotas.md)                      | Attachment Storage Quotas: Soft Byte Ceilings per Workspace and per Instance                             | Accepted                                               | 2026-08-18 |
| [0028](0028-open-contributions-hosted-service.md)      | Open Contributions Under AGPL-3.0, No CLA; Revenue Only From a Hosted Service                            | Accepted (supersedes 0014, 0015)                       | 2026-08-21 |

A status can later change to **Superseded**, with a link to the ADR that
replaces it (e.g. `**Status:** Superseded by [0012](0012-....md)`).

## Adding a new ADR

1. Copy the template below into a new file: `docs/decisions/NNNN-kebab-title.md`,
   where `NNNN` is the next zero-padded four-digit number in sequence.
2. Fill in every section — leave nothing as a placeholder.
3. Add a row to the index table above.
4. Open a PR. Discussion happens on the PR; once merged, the ADR's status is
   `Accepted` and the record is treated as historical (edit later decisions by
   superseding, not by rewriting history).

## Template

```markdown
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by [NNNN](NNNN-file.md)
**Date:** YYYY-MM-DD

> 🌐 English (canonical) | [Türkçe](../tr/decisions/NNNN-kebab-title.md)

## Context

What problem or question forced this decision? What constraints applied?

## Decision

The choice made, stated plainly in one or two sentences.

## Rationale

Why this option, over the others, given the context above.

## Consequences

What this makes easier, what it makes harder, and any negative trade-offs —
stated honestly, not just the upside.

## Alternatives considered

| Alternative | Why not |
| ----------- | ------- |
| ...         | ...     |
```
