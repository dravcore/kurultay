# Testing

What Kurul tests, with which tools, and what CI enforces.

> 🌐 English (canonical) | [Türkçe](tr/testing.md)

## Contents

- [Strategy](#strategy)
- [The pyramid](#the-pyramid)
- [What must be tested](#what-must-be-tested)
- [Browser end-to-end](#browser-end-to-end)
- [File conventions](#file-conventions)
- [Running tests](#running-tests)
- [Writing tests](#writing-tests)
- [Coverage](#coverage)
- [CI](#ci)

## Strategy

Kurul’s MVP feature set is complete; the testing strategy stays deliberately
**pragmatic, not exhaustive**:

- Test the logic that is **hard to get right** and **expensive to get wrong** — ordering,
  tenant isolation, auth.
- Test the API **against a real PostgreSQL**, not a mocked Prisma client. Most bugs worth
  catching at this stage live in the query, not in the TypeScript.
- Do **not** chase a coverage number. Do not write tests that only restate the
  implementation.
- Browser e2e covers **seven flows, and deliberately no more** — the ones where the stack
  either holds together or does not. See [Browser end-to-end](#browser-end-to-end).

The cost of a test is not writing it — it is maintaining it through every refactor. Tests
are written where that cost buys real confidence.

## The pyramid

| Layer           | Tool                                   | Scope                                                                                     | Status                                                      |
| --------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Unit**        | Jest (`apps/api`), Vitest (`apps/web`) | Services, guards, pure functions, board/permission logic, DnD hooks. Dependencies mocked. | Required from day one                                       |
| **Integration** | Jest + Supertest                       | HTTP request → controller → service → **real Postgres** (via `docker-compose.dev.yml`)    | Required for every endpoint                                 |
| **E2E**         | Playwright                             | Browser flows across the full stack                                                       | Seven scenarios (`e2e/`) — nightly and before every release |

```
        /\        e2e — seven critical flows (Playwright, real Chromium)
       /  \
      /────\      integration — every endpoint (Supertest + real Postgres)
     /      \
    /────────\    unit — services, guards, pure logic (Jest), web logic/hooks (Vitest)
```

Full component-tree rendering tests are not part of the MVP. Web unit tests cover pure logic
(`lib/*.test.ts` — permissions, position math, mentions, query params) and the board
drag-and-drop hook in isolation; type safety plus integration coverage of the API is the
trade-off for everything else, and the board's own behaviour is covered end to end by the
seven browser scenarios below rather than by component tests covering it in pieces.

## What must be tested

These three areas are non-negotiable. A PR touching them without tests does not merge.

### 1. Fractional indexing (`Task.position`)

`Task.position` is a `Float` and the entire drag-and-drop ordering model depends on it. Cases
that must be covered:

| Case                               | Expectation                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Insert between two cards           | New position is strictly between the neighbours                                       |
| Insert at the top of a column      | Position is less than the current first                                               |
| Insert at the bottom               | Position is greater than the current last                                             |
| Insert into an empty column        | A valid starting position is produced                                                 |
| Move within the same column        | Only the moved row is updated                                                         |
| Move across columns                | `columnId` and `position` both update; no other row changes                           |
| Repeated inserts in the same gap   | Float precision is not exhausted; if the gap becomes too small, the column rebalances |
| Concurrent moves into the same gap | No two tasks end up with the same position, or the tie is resolved deterministically  |

The precision-exhaustion and concurrency cases are the ones that actually break in
production. Test them explicitly, not by implication.

### 2. Workspace isolation

Every query is scoped by `workspaceId`. This is the multi-tenancy guarantee and a security
boundary, so it is tested as one:

- A member of workspace A requesting a workspace B resource gets **404** (not 403 — do not
  confirm the resource exists).
- Nested routes verify the whole chain: a task must belong to a board that belongs to the
  workspace in the URL.
- List endpoints never return rows from another workspace, including when a filter or
  search term would match them.
- Role checks: `OWNER`/`ADMIN`/`MEMBER`/`GUEST` each hit at least one allowed and one
  denied case.

Because the isolation rule is enforced by a guard rather than by the type system, these
tests are the only mechanical enforcement it has.

### 3. Auth flows

- Register, login, logout, session refresh
- Unauthenticated request to a protected route → **401**
- Expired or tampered session → **401**
- Invite acceptance grants exactly the intended role

## Browser end-to-end

Browser e2e was deferred through the MVP for a reason that held: the board UI changed shape
weekly, and a suite written against it would have been rewritten three times. What the
deferral left behind was a gap nothing else could cover — the flows that make this product
what it is were verified by well over a thousand unit tests and an integration test for every
endpoint, and **not once in a real browser**. Both of those suites pass against a board that
never renders.

The suite lives in [`e2e/`](../e2e), runs a real Chromium against a compiled API and a
production web build, and is exactly seven scenarios. It started at four and has grown only
with features whose stack-level wiring nothing else could reach — a real multipart upload from a
real browser, a real file picker feeding the importer, and a viewport, a touchscreen and a
laid-out document, none of which exist in jsdom.

### The seven scenarios

| Scenario                                                                                    | File                                   | What it is the only coverage of                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in → open a board → drag a card → **reload and find it still moved**                   | `tests/board-drag-persistence.spec.ts` | That a pointer gesture in a browser produces the move request at all, and that the board reads back what it wrote                                                                                                               |
| A move in one browser appears **in a second browser**, with no reload                       | `tests/board-realtime.spec.ts`         | Socket.io handshake auth, board-room membership, and the client applying an id-only payload                                                                                                                                     |
| Invite from settings → **read the mail in Mailpit** → accept from the link                  | `tests/invitation.spec.ts`             | That the invitation mail is sent and carries a link that works — `acceptUrl` is built from `WEB_URL`, and the API's own tests assert on the DTO, not the message                                                                |
| Click a notification → **the right task opens**                                             | `tests/notification.spec.ts`           | A notification carries `taskId` but no `boardId`; the web resolves the board with a second request, in the browser, with the recipient's session                                                                                |
| Upload a file to a card → **download it back and compare the bytes**                        | `tests/task-attachment.spec.ts`        | A multipart body Chromium wrote rather than the API suite; a non-ASCII filename surviving both the upload encoding and `Content-Disposition`; the board card's count badge, which comes from a different query than the panel's |
| Import a Trello export from a file picker → **read the report on screen**                   | `tests/board-import.spec.ts`           | A real `<input type="file">` producing the boundary the API never composes itself, and the import report reaching the screen — it exists only in the body of the `201`, so a panel that drops it drops the only copy            |
| The board at **360px with a touchscreen** — drawer, 44px targets, column scroll, touch drag | `tests/mobile-navigation.spec.ts`      | Layout at a width, and input from a finger. jsdom lays nothing out, so every box measurement in a Vitest test is zeros; `hasTouch` / `isMobile` are context options a unit test has no equivalent of                            |

Anything outside those seven belongs in a unit or integration test. Every test added here is
one more thing to keep green through a UI refactor, and this suite exists to notice when the
**stack** comes apart — not to re-check what the layers below already cover.

### Running it

Postgres **and Mailpit** must be up (`docker compose -f docker-compose.dev.yml up -d`);
without Mailpit three of the seven scenarios cannot confirm an address or read an invitation.
Redis is not needed — see [Isolation](#isolation) for why the suite runs without it.

```bash
pnpm --filter @kurul/e2e browsers   # once: downloads Chromium
pnpm test:browser                      # builds the stack, then runs all seven
```

`pnpm test:browser` runs `e2e/build-stack.mjs` first — it builds `shared-types`,
`auth-access`, the API and a standalone web bundle, then migrates the suite's database.
Playwright starts and stops both servers itself. To iterate on a test without rebuilding, run
`pnpm --filter @kurul/e2e exec playwright test` directly; locally it reuses a stack that is
already listening.

**The web build is not interchangeable with `pnpm build`.** `NEXT_PUBLIC_API_URL` is inlined
at build time, so the suite's build hard-codes port 4110 into the client bundle and overwrites
`apps/web/.next`. After running the suite locally, rebuild before using
`pnpm --filter @kurul/web start`.

### Isolation

The suite boots a second copy of the application next to whatever is already running, and
never touches it:

| Thing           | Value                    | Why                                                                               |
| --------------- | ------------------------ | --------------------------------------------------------------------------------- |
| Web / API ports | 3110 / 4110              | 3000/4000 belong to `pnpm dev`                                                    |
| Database        | `kurul_test_playwright`  | Not `kurul_test` — the Jest integration suite truncates that one between tests    |
| Redis           | none — `REDIS_URL` blank | See below; running without Redis is a supported configuration                     |
| Mail            | the shared Mailpit       | Nothing is ever deleted; every lookup is scoped to an address the suite generated |

None of it is configurable through `.env`, and it adds no environment variables: the Postgres
_connection_ is derived from `DATABASE_URL` with only the database name swapped. A
misconfigured variable here would mean a suite that silently ran against the development
database, which is the one failure this arrangement is built to make impossible. The reasoning
is written out in `e2e/stack-env.ts`.

**Why no Redis.** A logical database index was the obvious boundary and it used to be a fiction:
`parseRedisUrl` dropped the URL's pathname, and every ioredis/BullMQ construction in `apps/api`
goes through it, so `redis://…/8` connected to database 0
(issue [#190](https://github.com/dravcore/kurul/issues/190)). That is fixed — the index now
reaches every consumer — but it separates a _keyspace_, not a channel: Redis pub/sub ignores the
database, so the Socket.io fan-out channel is shared by every client of that server whichever
index it selected, and a key prefix is not available either since BullMQ's prefix and the
adapter's channel names are chosen in `apps/api` source. An index would therefore separate the
part that actually bit — two API instances sharing the `due-soon` _queue_ take turns running
each other's scheduled scans against the wrong database — at the cost of booting the adapter and
the worker inside the suite, which is a behaviour change worth its own verification rather than
an assumption. Until then the suite runs with none, which the API supports outright: readiness
reports Redis `skipped`, the gateway logs that the adapter was not attached, the due-soon worker
declines to start. With a single API process the adapter would only be fanning messages back to
their own publisher, so nothing under test loses coverage. The database index itself is covered
where it belongs, against a live server, in `apps/api/test/redis-database-index.e2e-spec.ts`.

### How these tests are written

- **Setup goes over HTTP, behaviour goes through the UI.** Accounts, workspaces, boards and
  cards are created with API calls; only the behaviour under test is clicked. Driving setup
  with clicks would make every scenario also a test of registration and workspace creation,
  so one change would turn every scenario red at once and none of them would be saying anything
  true.
- **No `data-testid`.** There is not one in this application's production code and the suite
  adds none. Columns are `<section aria-label>`, cards carry `aria-label="Reorder <title>"` on
  their grip — asserting through the accessible surface means a change that breaks a
  screen-reader user also breaks this suite.
- **No fixed waits, anywhere.** `expect.poll` and web-first assertions only. A `sleep` is
  either too short on the busiest machine or wasted time on every other one.
- **No retries, including in CI.** A retry turns a flake into a green run, which is the
  fastest way to make a suite stop meaning anything.
- **Never assert on `Task.position`.** It is a Float produced by fractional indexing and
  rebalancing may change it at any time. The _order_ is the contract.
- **A drop assertion before a reload proves nothing.** The board applies moves optimistically,
  so the order changes on screen whether or not anything was persisted. The reload is the
  test.

### Prove the test can fail

A passing browser test is unusually easy to be wrong about: an un-awaited assertion is always
green, and a scenario can quietly assert on the optimistic UI instead of the stored state.
Before a scenario is considered done, **break the thing it protects and watch it go red.**
The original four were checked exactly that way — removing the position PATCH, the
`task:moved` emit, the accept link from the invitation mail, and the task segment from the
notification's navigation target. Three of those four kept passing up to their final
assertion, which is the point: that final assertion is the whole test.

The two scenarios added since carry the same guarantee in a second form, because it is cheaper to
keep: **every positive assertion is paired with the negative that precedes it.** The attachment
list's empty state is asserted before the upload and the card badge is asserted absent before it
is asserted present; the board list's empty state is asserted before the import and the report
region is asserted hidden before it is asserted visible. A scenario that would still pass with the
feature ripped out is the failure this section exists to prevent, and an asserted absence is what
makes that impossible rather than unlikely.

## File conventions

| Kind                   | Location                       | Pattern                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                   | Colocated with the source file | `apps/api/src/task/task.service.spec.ts`                                                                                                                                                                                                                        |
| Integration            | Separate test root             | `apps/api/test/task.e2e-spec.ts`                                                                                                                                                                                                                                |
| Test helpers/factories | Shared under the test root     | `apps/api/test/helpers/`, `apps/api/test/factories/`                                                                                                                                                                                                            |
| Temporary storage root | Beside the database helper     | `apps/api/test/helpers/storage.ts`                                                                                                                                                                                                                              |
| Input fixtures         | Under the test root, by source | `apps/api/test/fixtures/trello/` — hand-written Trello exports read by both unit and integration tests, plus two anonymised real exports under `real/`; the directory's own README records which is which ([ADR 0025](decisions/0025-trello-import-mapping.md)) |
| Browser e2e            | Repository-level package       | `e2e/tests/board-realtime.spec.ts`                                                                                                                                                                                                                              |
| Browser e2e helpers    | Beside them                    | `e2e/support/`, `e2e/stack-env.ts`                                                                                                                                                                                                                              |

Nest's generator calls integration tests `*.e2e-spec.ts`; that name is kept for tooling
compatibility even though these are API integration tests, not browser e2e.

**Real Trello exports.** `apps/api/test/fixtures/trello/real/` holds real exports that went
through `scripts/anonymise-trello-export.mjs` (structure kept byte for byte, every piece of text
replaced by a same-length pseudonym) — as of 2026-08-22, two of them, Trello's own default
"Starter Guide" board and an eleven-list board. `trello-import-real.e2e-spec.ts` imports every
`*.json` in it through the real endpoint and checks the report and the database against counts
derived from the file; both import cleanly, with no reader-level field-mapping diff against the
synthetic fixtures ([`fixtures/trello/README.md#field-mapping-diffs`](../apps/api/test/fixtures/trello/README.md#field-mapping-diffs)).
Were the directory ever empty, the spec would report exactly one skipped test,
`no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)`, so an open gate
would stay visible in CI. The anonymiser's own unit tests run on `node:test` via
`pnpm test:scripts`, because `scripts/` has no dependencies; the same spec also proves, on the
synthetic fixture, that an anonymised export imports identically to its original.

## Running tests

```bash
# Services must be up for integration tests
docker compose -f docker-compose.dev.yml up -d

pnpm --filter @kurul/api test          # api unit
pnpm --filter @kurul/api test:watch    # api unit, watch mode
pnpm --filter @kurul/api test:e2e      # integration (needs Postgres)
pnpm --filter @kurul/api test:cov      # api coverage report

pnpm --filter @kurul/web test          # web unit (Vitest)
pnpm --filter @kurul/web test:watch    # web unit, watch mode

pnpm test:scripts                         # scripts/ (node:test, no dependencies)

pnpm test:browser                         # browser e2e (needs Mailpit too)
```

Integration tests run against a **separate database** (`kurul_test`), created and
migrated by the test setup. They never touch the development database. The browser suite
uses a third one — see [Isolation](#isolation).

None of these commands needs `packages/*/dist`. Both Jest configs and the Vitest configs map
`@kurul/shared-types` and `@kurul/auth-access` to the packages' `src/index.ts`, so the suites
compile the same source `pnpm typecheck` reads and cannot pass against a stale build;
`apps/api/src/workspace-packages.spec.ts`, `apps/api/test/harness.e2e-spec.ts` and
`apps/web/workspace-packages.test.ts` fail if that mapping is ever removed. The build is still
required for `pnpm typecheck`, `nest build`, `next build` and `pnpm dev`, see
[development.md](development.md#clone-and-install).

## Writing tests

- **Arrange–Act–Assert**, with blank lines between the three parts.
- Test names describe behavior, not method names:
  `it('returns 404 when the board belongs to another workspace')`, not `it('findOne works')`.
- One behavior per test. If the name needs "and", split it.
- Use factories/builders for entities; do not hand-write the same 15-field task literal in
  twenty tests.
- **Each integration test cleans up after itself** — truncate the affected tables in
  `afterEach` or wrap the test in a transaction that is rolled back. Order-dependent test
  suites are a bug. **The temporary directory counts as state too**: a spec that exercises
  storage creates its own root with `createTempStorageDir()` and removes it in `afterEach` with
  `removeTempStorageDir()` (`test/helpers/storage.ts`), the same way `helpers/db.ts` answers the
  same question about rows.
- **Storage is tested against a real directory, never a memory backend.** ADR 0022 rejected an
  in-memory `StorageBackend` for the same reason this file forbids mocking Prisma in
  integration tests: it would be a class that exists only for tests, and the codebase has no
  precedent for one — `LogMailSender`, the closest thing to it, is also a production fallback.
  Writing to a real filesystem is what makes path handling, permissions and the read-stream
  path testable at all, and those are exactly the three things a fake would have gotten right
  by construction.
- Mock only what crosses a process boundary you do not control (email, third-party HTTP).
  Do not mock Prisma in integration tests — that is the point of them. The browser suite
  mocks nothing at all, including mail: it reads what was sent out of Mailpit.
- No `setTimeout`-based waiting. Await the thing.
- A bug fix ships with a regression test that fails before the fix.

## Coverage

**Coverage is a signal first.** There is no repo-wide target and no ambition to raise a
number for its own sake.

- Use the report to find code that no test exercises, then decide whether that code
  _deserves_ a test.
- Low coverage on a positioning algorithm is a problem. Low coverage on a DTO or a barrel
  file is not.
- Gaming a threshold with assertion-free tests is worse than having no threshold. That is
  why floors are scoped to code that is already meaningfully tested, never applied globally
  to pull an average up.

### Where floors do exist

These floors keep already-covered code from sliding back. Each fails CI.

| Scope                                   | Floor                                                 | Set in                      |
| --------------------------------------- | ----------------------------------------------------- | --------------------------- |
| `apps/api` global                       | statements 75 / branches 66 / functions 77 / lines 76 | `apps/api/jest.config.cjs`  |
| `apps/web` `app/**`                     | statements 85 / branches 90 / functions 85 / lines 85 | `apps/web/vitest.config.ts` |
| `apps/web` `components/board/**`        | statements 65 / branches 54 / functions 54 / lines 70 | `apps/web/vitest.config.ts` |
| `apps/web` `components/task/**`         | statements 60 / branches 60 / functions 58 / lines 62 | `apps/web/vitest.config.ts` |
| `apps/web` `components/layout/**`       | statements 75 / branches 65 / functions 85 / lines 78 | `apps/web/vitest.config.ts` |
| `apps/web` `components/notification/**` | statements 91 / branches 83 / functions 95 / lines 93 | `apps/web/vitest.config.ts` |
| `apps/web` `lib/**`                     | statements 91 / branches 83 / functions 93 / lines 92 | `apps/web/vitest.config.ts` |

All sit a few points under the measurement taken when they were introduced — enough margin
that a routine refactor does not trip them, tight enough that deleting a test does.

`apps/web` has **no global floor**, deliberately. Overall web coverage is around 83% of
instrumented statements in recent runs, but that average still mixes heavily-tested hooks with
thin page shells; a global floor at the average would catch little. Folder floors cover the
surfaces that already have meaningful unit tests: route entrypoints (`app/**`), the
interactive board / task / layout / notification components, and the `lib/**` helpers behind
them. `apps/web/vitest.config.ts` carries the full reasoning inline.

**What a folder floor does not catch.** Coverage is reported for files a test _imports_, not
for every file on disk. Deleting the last test that imports a module therefore takes the
module out of the denominator rather than pushing the percentage down, and the floor stays
green. Floors catch a test being weakened, not a module being abandoned; the second case is
what code review is for. Measured on the `components/notification/**` floor: removing the
click-through tests from `notifications-list.test.tsx` fails it four ways
(75.00 / 66.35 / 71.18 / 80.11 against 91 / 83 / 95 / 93), while deleting that whole file
passes.

The global stance is revisited at 1.0, when the API is stable enough for a repo-wide floor to
be meaningful.

Both suites publish their HTML/JSON reports as CI artifacts (`api-coverage`, `web-coverage`)
on every run, passing or failing.

## CI

Every pull request runs, on `develop` and `main` as well:

| Step                 | Command                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Build shared pkgs    | `pnpm --filter @kurul/shared-types build && pnpm --filter @kurul/auth-access build`                      |
| Lint                 | `pnpm lint`                                                                                              |
| Format check         | `pnpm format:check`                                                                                      |
| Typecheck            | `pnpm typecheck` (`tsc --noEmit` across workspaces)                                                      |
| Audit                | `pnpm audit --audit-level high`                                                                          |
| Unit tests (api)     | `pnpm --filter @kurul/api test:cov`                                                                      |
| Unit tests (web)     | `pnpm --filter @kurul/web exec vitest run --coverage`                                                    |
| Unit tests (pkgs)    | `pnpm --filter "./packages/*" test`                                                                      |
| Unit tests (scripts) | `pnpm test:scripts`                                                                                      |
| Integration tests    | `pnpm --filter @kurul/api test:e2e` against Postgres and Redis service containers                        |
| Build                | `pnpm build`                                                                                             |
| Image build + scan   | The three shipped images, then Trivy over each (see below)                                               |
| **Gate** (required)  | `ci-ok` — passes only if `lint`, `test`, `build` and `image-scan` all succeed (not skipped or cancelled) |

**All steps must pass before merge.** The gate job (`ci-ok`) is the single required status check
configured in branch protection — if any upstream job fails, is skipped, or is cancelled, the
gate fails. This provides two protections:

1. **Correctness**: a job that never ran cannot pass the gate. Branch protection treats a
   _skipped_ required check as satisfied, which is how [#89](https://github.com/dravcore/kurul/pull/89)
   merged with `test` red and `build` skipped. `ci-ok` runs under `if: always()` and asserts
   every `needs.*.result` is exactly `success`, so `failure`, `skipped` and `cancelled` all
   fail the gate.
2. **A stable contract with branch protection**: protection now names one context, `ci-ok`,
   instead of tracking every job name. Adding, splitting or renaming a job is a `ci.yml` edit
   with no settings change, and the failure mode of getting it wrong stays inside CI — the
   workflow refuses to load an unknown `needs` entry, so nothing reports and the PR stays
   blocked. Previously the same mistake left protection waiting on a context that no longer
   existed.

CI runs on pull requests to any branch (`pull_request.branches: ['**']`) and on pushes to
`develop` and `main`. See [git-strategy.md](git-strategy.md#pull-request-process).

The workflow file is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### Image build and CVE scan

`image-scan` builds the three images this project ships (`kurul-api` at its `runner` and
`migrate` targets, and `kurul-web`) and runs Trivy over each one. A HIGH or CRITICAL
vulnerability **that has a fix available** fails the leg, and with it the gate. Before this
job existed the only thing that ever built a Dockerfile was `release-images.yml`, which runs
on a tag push, so a broken image or a vulnerable base was found by the workflow whose job is
to publish it.

Two choices are worth knowing about:

- **Unfixed advisories are ignored** (`ignore-unfixed: true`). A base-image CVE with no fixed
  version anywhere would fail every pull request for something no pull request can do, and a
  check that is always red is a check nobody reads. What is left is the actionable set: a base
  image bump or a dependency bump.
- **It runs beside `lint` and `test`, not after `build`.** The job is off the critical path on
  purpose, so it costs runner minutes rather than pipeline wall time, and it reads a buildx
  layer cache (`type=gha`) that the `develop` runs of this same workflow write.

Nothing is pushed: `push: false` with `load: true` keeps each image inside its own runner.
Publishing stays in `release-images.yml`, behind a tag.

### Browser e2e in CI

The browser suite runs in its own workflow,
[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml), on a different schedule and
**outside the `ci-ok` gate**:

| Trigger                   | Why                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Nightly, 03:00 UTC        | Late enough to include the day's merges, early enough that a red run is waiting in the morning       |
| Pull requests into `main` | Only `release/*` and `hotfix/*` open those, so this is exactly once per release candidate and hotfix |
| `workflow_dispatch`       | On demand                                                                                            |

It is not a required check on purpose. This suite starts Postgres, Redis, Mailpit, a compiled
API and a production web build, then drives Chromium through all of it — the project's most
valuable signal and also the most expensive one to be wrong about. Wired into the required
gate, one infrastructure hiccup would block every merge in the repository. `ci.yml` stays the
fast, required loop; a failure here means "look at this before shipping", not "stop".

The whole suite is capped at **five minutes** by `globalTimeout` in
`e2e/playwright.config.ts` — enforced rather than aspired to, and enforced locally as well as
in CI, so the run that first exceeds the budget is the one on the author's machine. The HTML
report is uploaded on every run and the traces on failure, which is what makes a nightly
failure diagnosable the next morning without reproducing it.

## See also

- [development.md](development.md) — running services locally
- [coding-standards.md](coding-standards.md) — code conventions tests assume
- [api-conventions.md](api-conventions.md) — status codes and error shapes to assert on
- [git-strategy.md](git-strategy.md) — PR requirements
- [../ROADMAP.md](../ROADMAP.md) — MVP status and Beyond MVP
