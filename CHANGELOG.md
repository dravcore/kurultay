# Changelog

All notable changes to Kurul are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-22

_Finding IDs such as `SEC-02`, `OPS-04` and `OPS-05` are scoped to the audit wave that
produced them: the same ID means different things in the 0.1.0 audit, the 0.2.0 audit and
the 2026-08-18 "atlas" audit. See
[ROADMAP.md](ROADMAP.md#deferred-with-triggers-from-the-2026-08-13-audit)._

### Fixed

- **The test suites no longer read `packages/*/dist`.** `@kurul/shared-types` and
  `@kurul/auth-access` resolve through their `package.json` to a git-ignored build, so a fresh
  checkout failed `pnpm test` with `Cannot find module '@kurul/shared-types'` (Jest) and
  `Failed to resolve entry for package "@kurul/shared-types"` (Vitest), and a checkout with an
  old build passed against last week's enums. Both Jest configs (`moduleNameMapper` plus a
  matching `paths` entry for ts-jest, and a mapper that lets the packages' NodeNext `.js`
  imports resolve to `.ts`) and both Vitest configs (`resolve.alias`) now point the two
  specifiers at `src/index.ts`; `packages/auth-access`'s own suite, which imports
  `@kurul/shared-types`, gets the same alias. A spec in each runner asserts the mapping holds,
  and the CI test job no longer builds the packages, so it runs the way a fresh clone does.
  The build is still needed for `pnpm typecheck`, `nest build`, `next build`, `pnpm dev` and
  `pnpm db:seed`.

- **The task search box treated `%` and `_` as SQL wildcards instead of the characters a user
  typed.** `q` reached Postgres through Prisma's `contains`, which — confirmed empirically
  against Postgres 18 — compiles to `ILIKE`/`LIKE` with the search string bound as a *pattern*,
  not a literal: searching `50%` also matched `"50X done"`, and `a_b` also matched `"aXb"`. A
  shared `escapeLikePattern` helper now escapes `%`, `_` and the backslash that escapes them
  before the string reaches `contains`, so the search box matches only what it looks like it
  matches. The same unescaped `contains` was also used to sweep a departing account's
  `Verification` rows during account deletion — an email local-part is free to contain `_`, so
  an erased `john_doe@example.com` could have deleted a stranger's live `johnXdoe@example.com`
  verification token too; that call site is escaped the same way (audit follow-up to DB-01).

- Dialog and auth submit errors are now announced to screen readers and receive focus (WCAG
  4.1.3, audit finding UX-01). Login, register, confirm, form, delete-account,
  delete-workspace and the Trello import dialog rendered their submit-level error as plain
  text with no toast on this path, so assistive tech never heard it and sighted keyboard users
  had no cue where it landed; the shared `SubmitError` component now marks it `role="alert"`
  and moves focus to it on every mount, including a retry that fails with the exact same
  wording.

- **An attachment can no longer be stored half-file and half-link.** `AttachmentKind` was
  introduced so that `storageKey`, `mimeType`, `size` and `url` would be nullable *because of*
  `kind` rather than in general ([ADR 0024](docs/decisions/0024-attachment-kinds-and-serving-policy.md)),
  and the schema comment promised that a row carrying both a URL and a storage key — or neither —
  was unwritable. Nothing enforced it: the four columns were plainly nullable, and the promise
  held only as long as every writer happened to be `AttachmentService`. The Trello importer is a
  writer that is not — it bulk-inserts attachment rows with `createMany` — which is the exact
  case the ADR predicted. A CHECK constraint, `Attachment_kind_fields_check`, now makes the two
  shapes the only ones the table accepts (audit finding DB-02).

  **The migration validates existing rows rather than grandfathering them**, so an instance that
  somehow holds a half-written attachment fails the upgrade with the offending constraint named
  instead of carrying the row forward under a constraint that only applies to future writes.
  Every row the shipped code can have written satisfies the predicate, so no action is expected
  on upgrade.

- **The curl-based self-host install could never finish, and scheduled backups silently never
  ran.** [self-hosting.md](docs/self-hosting.md) downloads only `docker-compose.yml`,
  `docker/Caddyfile` and `.env.example` — no source tree — but the `migrate` service was
  `build:`-only, so `docker compose up -d` had nothing to build it from and `api`
  (`depends_on migrate: service_completed_successfully`) could never start: the guide's "no
  build step" promise was unfulfillable on the path it documents. A third published image,
  `ghcr.io/dravcore/kurul-migrate`, fixes that — built from `apps/api/Dockerfile`'s `migrate`
  stage on `linux/amd64` + `linux/arm64`, following the same per-arch build, digest merge,
  cosign signature and SBOM pattern already applied to `kurul-api` and `kurul-web`
  ([release-images.yml](.github/workflows/release-images.yml)). `docker-compose.yml`'s
  `migrate` service now carries `image: ghcr.io/dravcore/kurul-migrate:${TAG:-latest}`
  alongside its existing `build:`, the same fallback pair `api`/`web` already had.

  Independently, the same download step never fetched `scripts/backup.sh` either, which the
  `backup` service bind-mounts — so on a fresh curl-based install, scheduled backups silently
  never ran, with nothing in the logs to say why.
  [self-hosting.md](docs/self-hosting.md) (+ [tr mirror](docs/tr/self-hosting.md)) now
  downloads it alongside the compose file.

  **`kurul-migrate` exists from the first release after v0.2.0 onward, not on v0.2.0 itself** —
  the workflow that publishes it is new in this change. An operator following the curl-based
  guide against a `v0.2.0` install still hits the original failure; `git clone` is the
  documented workaround until the next tag ships, and the guide now says so up front instead
  of leaving that to be discovered from a pull failure.

  Audit finding OPS-01.
- **The `backup` service now declares a healthcheck** (audit finding OPS-02). `scripts/backup.sh`'s
  main loop runs `take_dump || true` / `take_files || true`, so a cycle that fails only logs and
  keeps sleeping — the process never exits non-zero, and until now nothing about the container's
  own state changed either, so a backup could silently stop being produced with `docker compose ps`
  still reporting the service as simply "Up". RPO grew unbounded and invisibly, and the API's
  retention sweep (`BACKUP_KEEP × BACKUP_INTERVAL` grace window, `cleanup.worker.ts`) silently
  assumed dumps were actually landing.

  Unhealthy now means: no `/backups/kurul-*.dump` modified in the last `2 × BACKUP_INTERVAL`
  seconds (48h on the default 24h interval — 2× so one slow or skipped cycle doesn't flap the
  status). The check reads `$BACKUP_INTERVAL` from the container's own environment, so it tracks
  whatever an operator's `.env` sets rather than assuming the default. It uses `find -mmin`, not
  GNU `find`'s `-newermt`: the image is `postgres:18-alpine`, whose `find` is BusyBox's and has
  neither `-newermt` nor `-newermin` (confirmed with `docker run --rm postgres:18-alpine find
  --help`). `start_period` (10 minutes) is sized to the first `pg_dump` completing, not to
  `BACKUP_INTERVAL` — the first cycle starts at container boot, not after one interval elapses, so
  tying it to a 24h default would hide a genuinely broken first cycle for most of a day.

  `docs/self-hosting.md` (and its `docs/tr/` mirror) no longer says `backup` declares no
  healthcheck, and now has a "watch backup freshness" bullet next to the existing
  `/api/health/ready` monitoring guidance — that endpoint never touches the backup sidecar, so it
  stays green through a backup outage. `scripts/bootstrap.mjs`'s comment on which dev-loop
  containers declare healthchecks is updated to match (`docker-compose.dev.yml` has no `backup`
  service of its own, so this doesn't change what that script waits on).

### Added

- **Email notifications** ([#255](https://github.com/dravcore/kurul/discussions/255)). An
  assignment, a mention in a comment and a due-soon reminder now also arrive by email, in the
  recipient's stored language (`User.locale`, falling back to English), with a link to the
  card. One message per stored `Notification` row, sent after the transaction commits through
  the transport the invitation email already uses; a failed send is logged and never fails the
  request that caused it, and an instance without `SMTP_HOST` sends nothing and changes
  nothing. The switch is `User.emailNotifications` (default `true`), one boolean for every kind,
  read and written through `GET /me` / `PATCH /me` and shown as a checkbox under
  Settings > Notifications in both languages. There is no digest: the existing per-comment and
  per-24h dedupe in the notification paths is the only batching, and that is recorded as an
  open question on the roadmap row rather than built. Covered by template, mailer and worker
  unit tests, a settings component test, and an e2e scenario that captures the message for a
  Turkish assignee and checks that nothing goes out after they opt out.

- **`pnpm db:drift` checks the configured database against `schema.prisma` for migration
  drift** (roadmap Hardening: "migration drift check"). It runs `prisma migrate diff
  --from-config-datasource --to-schema apps/api/prisma/schema.prisma --exit-code`, printing
  "No difference detected." and exiting `0` when they agree, or naming the mismatch and
  exiting non-zero otherwise. CI's "Check for migration drift" step, which already ran this
  command right after `db:migrate`, now calls `pnpm db:drift` instead of repeating the raw
  invocation, so a local pass and a CI pass mean the same thing. No `kurul_shadow` database was
  added: Prisma 7.9.1 has no CLI flag for a shadow database on this command, and setting
  `datasource.shadowDatabaseUrl` in `prisma.config.ts` changes `migrate dev` behaviour too,
  which this change did not need.

- **A per-IP byte budget on the upload route** (audit finding SEC-02 follow-up,
  [ADR 0027](docs/decisions/0027-attachment-quotas.md)'s 2026-08-21 update). The route's
  request throttle counts requests, which `rate-limit.ts` has called the wrong unit for disk
  since it shipped: twenty 25 MiB uploads and twenty 10 kB uploads spent the same allowance.
  `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` (default `268435456`, 256 MiB a minute, about ten
  max-size uploads; `0` switches it off, negative refuses to boot) is now charged per client IP
  over a fixed minute by a guard that runs before multer touches the body, so a refused request
  costs the API no heap. The charge is the request's `Content-Length`; a multipart request that
  declares none is charged `ATTACHMENT_MAX_BYTES`, and a JSON body (a LINK, which stores
  nothing) is not charged. Over budget answers `429` with `error: "Upload Budget Exceeded"`, a
  new constant in `@kurul/shared-types` beside the quota's, plus `Retry-After`; the request
  throttle's `429` keeps `"Too Many Requests"`, so a client can tell the two apart without
  reading `message`. Counters live in Redis when `REDIS_URL` is set and degrade to a bounded
  per-process counter on Redis errors, the same shape as the SEC-03 fix for the `/auth/*`
  limiter rather than failing open. It honours `RATE_LIMIT_ENABLED` and `TRUST_PROXY` like
  every other limit, and the upload route's OpenAPI `429` now describes both budgets.
- **A harness for verifying the Trello importer against real exports, and the anonymiser that
  makes committing one possible.** `scripts/anonymise-trello-export.mjs` (node built-ins only)
  takes a board's JSON export and rewrites every piece of personal or proprietary text (board,
  list, card, checklist and label names, descriptions, comments, member details, attachment names
  and URLs, custom field names and values, e-mail addresses and URLs wherever they appear) into
  deterministic, seeded pseudonyms of the same length and shape, while keeping the structure the
  importer reads byte for byte: keys and their order, array lengths, nulls, booleans, numbers,
  dates, colours, `closed` flags, and every id relationship (Trello ids are remapped consistently,
  keeping their timestamp prefix and sort order). A URL that also looks like an e-mail address
  (`mailto:`, userinfo, an `@` in the path) stays a URL with its scheme, a file extension is
  kept only on an attachment's name and only from a known list, so a `first.last` handle or an
  honorific never survives as a tail, and the output is written the way the input was formatted,
  so Trello's minified export stays minified and the import size limit applies to both alike. It
  prints a count summary and lists every top-level key and string-carrying key path it did not
  recognise, in the spirit of ADR 0025.
  `apps/api/test/fixtures/trello/real/` is where the output goes;
  `apps/api/test/trello-import-real.e2e-spec.ts` imports every file found there through the real
  endpoint and checks the report and the database against counts derived from the file, and while
  the directory is empty it reports one visibly skipped test naming the open `v0.3.0` gate. A
  guard that runs regardless proves the anonymised synthetic fixture imports identically to the
  original. The anonymiser's unit tests run on `node:test` (`pnpm test:scripts`, also in CI). The
  gate itself stays open until two anonymised real exports are in the directory and the
  field-mapping diffs are recorded in the fixtures README.

- **The `v0.3.0` Trello real-export gate closed.** Two anonymised real Trello exports —
  Trello's own default "Starter Guide" board and an eleven-list board, both exported and
  anonymised on 2026-08-22 — are now in `apps/api/test/fixtures/trello/real/`, and
  `trello-import-real.e2e-spec.ts` imports both end to end with no reader-level field-mapping
  diff against the synthetic fixtures: every field `trello-export.ts` reads matched the type
  ADR 0025 already assumed, including a fractional `lists[].pos`, the `purple_light`
  `_light` colour suffix alongside the already-covered `_dark`, and Trello's own empty-name
  default labels. No importer change was needed. The findings are recorded in
  `apps/api/test/fixtures/trello/README.md#field-mapping-diffs`.

- **Attachment storage quotas — the total is finally bounded, not just each file** (audit
  finding SEC-02, [ADR 0027](docs/decisions/0027-attachment-quotas.md)). Two new variables cap
  the summed size of stored file attachments: `ATTACHMENT_WORKSPACE_QUOTA_BYTES` per workspace
  and `ATTACHMENT_INSTANCE_QUOTA_BYTES` instance-wide. Until now the only ceilings were
  per-file and per-minute, which the rate-limit code itself called the wrong unit: at the
  defaults an authenticated client could spend ~500 MiB of disk a minute indefinitely, on a
  volume the Compose stack shares with Postgres. Both quotas default to unset — unlimited,
  exactly the pre-upgrade behaviour — and `0` means the same, matching the retention windows'
  spelling. The quota counts live FILE rows only (link attachments store no bytes and never
  count), is checked before anything touches the disk, and is deliberately soft: concurrent
  uploads can each overshoot by at most one file. A rejected upload answers `413` with
  `error: "Attachment Quota Exceeded"` in the envelope — distinguishable from the per-file
  limit's `413` by that field, which is what the web now branches on to tell the user to free
  up space rather than shrink the file.

- **`pnpm bootstrap` — a fresh clone reaches a running dev loop in one command.**
  [`scripts/bootstrap.mjs`](scripts/bootstrap.mjs) runs the five commands the dev loop already
  documented, in the same order (shared-package build → `db:generate` → dev containers →
  `db:migrate` → `db:seed`), and adds the two things a reader cannot add by replaying them:
  a preflight that reads `.env` before anything is started, and a wait on the containers' own
  healthchecks. It is the documented path rather than a second, faster one — if the script and
  [development.md](docs/development.md) disagree, one of them is a bug.

  The preflight exists because these failures otherwise arrive late and named after the wrong
  thing: an empty `POSTGRES_PASSWORD`, an empty `BETTER_AUTH_SECRET`, or a `DATABASE_URL` still
  carrying the `<POSTGRES_PASSWORD>` placeholder from `.env.example` each surface only once
  something tries to connect, with an error that mentions neither `.env` nor the variable.

  **Re-running it is safe, and that is a constraint rather than a convenience.** `pnpm db:seed`
  deletes before it inserts, so a script anybody is told to run after a `git pull` must not be
  one that quietly wipes the board they were working on: seeding happens only when the database
  holds no `Workspace` row, `--seed` forces it anyway, `--no-seed` skips it, and a database it
  cannot read is treated as "do not seed" rather than as consent. The script is named
  `bootstrap` and not `setup` because `pnpm setup` is a built-in pnpm command that writes to
  your shell profile.

- **A Community section in both READMEs, and GitHub Discussions declared the official channel.**
  Q&A for setup and usage, Ideas for roadmap feedback, Show and tell for what you built; bugs
  stay [issues](https://github.com/dravcore/kurul/issues) and vulnerabilities stay
  [SECURITY.md](SECURITY.md). The section also states, up front rather than as a discovery,
  how a contribution is accepted: code, documentation and translations are all welcome under
  plain AGPL-3.0 with nothing to sign
  ([ADR 0028](docs/decisions/0028-open-contributions-hosted-service.md)), because a project
  that asks for feedback owes people the shape of the door before they walk through it.

- **Every Beyond-MVP row now links to a discussion that can be upvoted**
  ([ROADMAP.md](ROADMAP.md#beyond-mvp), thirteen rows). Votes do not order the list — an
  unscheduled row stays unscheduled — but a row with people behind it and a concrete use case
  attached is the only thing that moves one off it, and there was previously nowhere for that
  to accumulate.

- **`INVITATION_RETENTION_DAYS` (default `90`) — the nightly sweep now covers a sixth table,
  `WorkspaceInvitation`.** It is the one address in the schema that need not belong to a user of
  the instance: invite somebody who never signs up and there is no account for any deletion path
  to reach, so before this the row kept a third party's e-mail address for the life of the
  install. A row is deleted once it is **finished** — answered (accepted, rejected, canceled) or
  past `expiresAt` — **and** older than the window; a `pending`, unexpired invitation is exempt
  at any age, because it is a live grant of access somebody can still accept. `0` keeps them
  forever, like the other windows.

  The window is measured from `createdAt`, the only timestamp the table has, which deletes the
  record slightly earlier than measuring from the answer would — bounded by how long a row can
  stay pending. Ninety days rather than `ACTIVITY_RETENTION_DAYS`' year because nobody browses a
  finished invitation (the settings screen lists `pending` rows only), so keeping it longer only
  stores an address. Its own variable rather than a share of `NOTIFICATION_RETENTION_DAYS`
  because shortening one is a decision about other people's data and shortening the other is
  tidying an inbox. Operators who need the old behaviour set `INVITATION_RETENTION_DAYS=0`
  before upgrading — the first nightly run after the upgrade deletes the accumulated backlog.

### Changed

- **Attachment quotas have finite defaults: an instance nobody configured is capped at 2 GiB
  per workspace and 20 GiB in total** (audit finding SEC-02,
  [ADR 0027](docs/decisions/0027-attachment-quotas.md), updated 2026-08-21). The quota engine
  shipped with "unset means unlimited", which left the audit's finding, unbounded disk
  consumption on a volume the Compose stack shares with Postgres, open for exactly the operator
  who never reads the quota section. Unset `ATTACHMENT_WORKSPACE_QUOTA_BYTES` now means
  `2147483648` and unset `ATTACHMENT_INSTANCE_QUOTA_BYTES` means `21474836480`; a written `0`
  is still the opt-out and a negative value is still refused at boot. The API logs the effective
  ceilings at start, marking each as `(default)` or `(env)`, and warns, rather than refusing,
  when the workspace quota is set above the instance quota or the upload byte budget is smaller
  than one max-size file. The 413 with `error: "Attachment Quota Exceeded"` is now proven by an
  integration test with the variables genuinely unset, against a real Postgres sum.

  **Upgrade note:** a workspace already holding more than 2 GiB of files, or an instance
  holding more than 20 GiB, gets a `413` on its next upload unless a higher number (or `0`) is
  set first. `docs/self-hosting.md` carries the one-line `SUM(size)` queries to check before
  upgrading. `.env.example` and `docker-compose.yml` ship the new numbers written in.

- **The Quick start in both READMEs is split into "Run it" and "Develop it".** The pull-based
  Docker path — the one for people who want to run Kurul rather than work on it — was
  previously the fourth paragraph of a section that opened with a toolchain. Developing it now
  also carries the prerequisite versions (Node ≥ 24, pnpm 9+, Compose v2, Git 2.30+), which
  the README had never stated at all, and spells out what skipping the shared-package build or
  `db:generate` actually looks like, since both fail as though the checkout were broken.

  One correction came out of the split: the instruction to match `DATABASE_URL`'s password
  segment to `POSTGRES_PASSWORD` was written as though it applied to every install. It applies
  to the dev loop only — `docker-compose.yml` assembles its own connection string from
  `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` and never reads that line.

- **Deleting an account now also deletes every invitation addressed to it, in any state.**
  `DELETE /me` and `DELETE /instance/users/:userId` anonymise the `User` row and used to remove
  only the invitations that account had *sent* and left pending. `WorkspaceInvitation.email` is a
  literal address in a column of its own — nothing about it is derived from `User` — so rewriting
  the row to `deleted-<id>@deleted.invalid` left every invitation ever sent *to* that person
  still spelling out where they can be reached, and an erasure request that leaves the address in
  the database has not erased it (audit finding DB-01).

  Accepted and rejected rows go too, unlike on the inviter side: an invitation addressed to the
  departing user is not somebody else's record of an event, it is a copy of that user's own
  contact details. What the workspace keeps is the membership history itself, in
  `WorkspaceMember` and `Activity`, which never carried the address. **For an operator this
  narrows what a dump can restore**: the erasure-recovery runbook in
  [development.md](docs/development.md#undoing-an-account-deletion) now lists invitee-side
  invitation rows as recoverable only from a dump that predates the deletion.

- **Outside contributions are accepted again, under plain AGPL-3.0 and with nothing to
  sign.** Code, documentation and translations are all welcome; the terms are inbound =
  outbound, so a contribution is licensed under the project's own AGPL-3.0 and its author
  keeps their copyright. There is no CLA, and no DCO for now
  ([ADR 0028](docs/decisions/0028-open-contributions-hosted-service.md), which supersedes
  [ADR 0014](docs/decisions/0014-dual-licensing-cla.md) and
  [ADR 0015](docs/decisions/0015-no-external-contributions.md) in full). What does not
  change: an issue first for anything non-trivial, the ~500-line pull request guideline, and
  review on every PR. CONTRIBUTING.md, the pull request template and both READMEs are
  rewritten around that.

- **Revenue comes from an optional hosted service instead of a commercial license.**
  Dravcore runs an instance anybody can have an account on, free within a published set of
  limits (seats, boards, storage and similar operational quantities) and paid above them.
  Self-hosting stays free forever with nothing held back: no open core, no paid edition, and
  no feature that exists only on our servers. The hosted service runs the same AGPL-3.0 code
  as this repository, the plan-limit and billing code included, which a self-hoster
  configures to taste or leaves switched off
  ([ADR 0028](docs/decisions/0028-open-contributions-hosted-service.md)).

- **The CLA draft moved to `docs/archive/cla-draft.md`** (and was deleted with the whole archive a day later, see Removed), its
  not-in-force banner intact. An agreement that was never enacted, and that nobody will now
  be asked to sign, is a historical record rather than a policy.

### Removed

- **The `CLA` workflow.** `.github/workflows/cla.yml` had been disabled since
  [ADR 0015](docs/decisions/0015-no-external-contributions.md) (manual trigger only, plus an
  `if: false` job guard); with no agreement for anybody to sign, there is nothing left for it
  to check, so it is deleted. Its last version stays in git history, which is where a DCO
  check would start from if contribution volume ever justifies one.

- **The commercial-license line and the `licensing@dravcore.com` address, from both
  READMEs.** Neither ever reached a release, but this section advertised them until today,
  so the removal is recorded here rather than left as a silent edit.

- **`docs/archive/` in full:** the Phase 0-9 checklists (`roadmap-mvp-phases.md`), the Phase 1
  scaffold how-to (`project-skeleton.md`), the shipped phase and visual-debt design specs, the
  finished implementation plans, and the never-enacted CLA draft that had been moved there a day
  earlier. A finished plan has nothing left to say that `ROADMAP.md`, an ADR or the code does not
  say better, and a second tree of historical markdown was a place for stale links to collect.
  Git history keeps every file; `CLAUDE.md`'s docs policy now says delete rather than archive.
  Links from `docs/`, both READMEs and the ADRs that pointed into the archive are rewritten or
  turned into plain text; the released entries below keep their old paths as text only.

### Security

- **Every pull request now builds the images this project ships and scans them for CVEs.**
  `.github/workflows/ci.yml` gains an `image-scan` job: three parallel legs build `kurul-api`
  at its `runner` and `migrate` targets and `kurul-web` (`push: false`, `load: true`, buildx
  with a `type=gha` layer cache scoped per image), then run Trivy over each. A HIGH or CRITICAL
  finding **that has a fix available** fails the leg and, through the `ci-ok` gate, the pull
  request. Until now the only workflow that ever built a Dockerfile was `release-images.yml`,
  which runs on a tag push, so a broken image or a vulnerable base was discovered by the
  workflow whose job is to publish it.

  The job hangs off nothing (`needs:` is absent) and runs beside `lint` and `test` rather than
  after `build`: the PR pipeline on `develop` measures 4m56s-5m18s against the five-minute
  trigger `ROADMAP.md` records for OPS-10, so this had to cost runner minutes and not wall
  time. Unfixed advisories are ignored (`ignore-unfixed: true`) because a base-image CVE with
  no fixed version fails every pull request for something no pull request can act on, and a
  check that is always red is a check nobody reads.

- **Removed the npm and yarn CLIs from all three runtime images.** Nothing in them ever ran
  either: every `CMD` is `node`, over dependencies that were resolved at build time. Beyond the
  ordinary case for not shipping a tool that fetches and executes code into a production
  container, this is what the first run of the scan above turned up: npm's own bundled
  dependencies (`tar`, `brace-expansion`, `ip-address`, `undici`) held **all eight** fixable
  HIGH/CRITICAL findings across the three images, and none of them is closable from this
  repository: they are fixed when the Node project cuts a `node:24-alpine` with a newer bundled
  npm. All three images now scan clean at HIGH/CRITICAL. `corepack` stays, as the shim the
  build stages go through. This does not change image size, since the files come from the base
  image's own layer.

- **`mailpit` is pinned by digest instead of `:latest`, in both `docker-compose.dev.yml` and
  the e2e workflow's `mailpit` service** — `axllent/mailpit:v1.31.0@sha256:c96991d9bef73594c246d89ca81411d4e916f03e76a7d2d72fa2ab5dd3c9ce24`
  (roadmap Hardening: "mailpit pinned by digest"). A floating `:latest` on an image used in CI
  and the local dev loop is the same class of finding as the workflow-action SHA pinning done
  earlier (SEC-06) applied to a service that had not yet been covered. `.github/dependabot.yml`
  gets a new `docker` ecosystem tracking the `docker-compose.dev.yml` pin (it also covers
  `docker-compose.yml`, which shares the same directory); the e2e workflow's own `services:`
  image sits outside what that ecosystem reads, so it stays a manual bump, with a comment at
  the call site saying so. PR-time image build + Trivy scan for `api`/`web` is a separate,
  still-open part of the same roadmap row.

- **Pinned `deepmerge-ts` to `^8.0.1` through a pnpm override**, closing
  [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) (high: stack
  exhaustion when merging recursive object graphs). It reaches this repository through exactly
  one root — `prisma > @prisma/config > deepmerge-ts@7.1.5`, fifteen paths, all of them that
  chain — and `pnpm audit --audit-level high` began failing on it on 2026-08-17, on a lockfile
  nothing had changed.

  An override rather than an upgrade because there is nothing to upgrade to: `prisma` and
  `@prisma/config` are at 7.9.1, the current release, and `@prisma/config` depends on
  `deepmerge-ts` at an **exact** `7.1.5` rather than a range, so no dependency bump reaches it.
  That also makes this override a **major** bump (7 → 8) on a version a vendor pinned
  deliberately, which is worth stating plainly rather than burying: the reason it is acceptable
  here is that it was verified rather than assumed, not that a major bump is ordinarily safe.

  Verified after the override: `prisma generate` loads `prisma.config.ts` and generates the
  client (that config load is the code path that reaches `deepmerge-ts` at all), and the full
  suite is green — 1314 API, 770 web, 44 `shared-types`, 6 `auth-access` — alongside `lint`,
  `typecheck`, `format:check`, `build` and `openapi:check`.

  Worth keeping in proportion: nothing here was exploitable in a running instance. This
  dependency is reached only while a Prisma CLI command merges configuration files, at build
  and migration time, and never touches request-borne input — the thing that was broken was a
  CI gate, not a deployment. The override should be dropped once Prisma ships a release that
  depends on `deepmerge-ts >= 8`.

- **`docker-compose.dev.yml` and `docker-compose.yml` shared the same implicit Compose project name** — the checkout's directory, usually `kurul`, since neither file declared its own
  — and therefore the same container and volume names for every service both define:
  `postgres`, `redis`, `postgres_data`, `redis_data`. Two failure modes came from that:
  `docker compose -f docker-compose.dev.yml down -v` (the documented way to reset a local
  database, docs/development.md#database-workflow) dropped the full stack's Postgres/Redis
  volumes too if the full stack had ever been started from the same directory, and bringing the
  full stack up afterward silently recreated the dev loop's `postgres` container from
  `docker-compose.yml`'s definition, which publishes no host port — `localhost:5432` simply
  stopped answering, with nothing anywhere naming why (OPS-04, 2026-08-18 audit).
  `docker-compose.dev.yml` now declares its own project (`name: kurul-dev`), so its containers
  and volumes (`kurul-dev_postgres_data`, …) are namespaced apart from the full stack's `kurul_*`
  ones and the two can run side by side with neither able to touch the other's data. Existing
  dev-loop containers/volumes under the old shared name are simply orphaned by this, not
  migrated — the dev database has always been throwaway by design; recreate with
  `pnpm bootstrap`. `scripts/bootstrap.mjs` needed no change: it already invokes compose with
  only `-f`, never `-p`, so it picks up the new project name automatically.

- **Every service in `docker-compose.yml` now carries a `mem_limit`** (`postgres`/`api`/`web`/
  `migrate` 512m, `backup` 256m, `redis`/`proxy` 128m) — `docs/self-hosting.md` has promised "2
  CPUs and 2 GB of RAM" is enough for a small team since it was written, but nothing enforced a
  ceiling on any one container, so the *kernel* OOM killer picked whichever process it scored
  worst when a host approached that budget, which is not necessarily the one that actually grew
  (OPS-05, 2026-08-18 audit). `api` and `web` also set `NODE_OPTIONS=--max-old-space-size=384`
  (75% of their 512m ceiling), pinning V8's heap explicitly rather than leaving it to Node's own
  container-memory heuristic — both buffer request data into that heap up to
  `REQUEST_BODY_MAX_BYTES`/`ATTACHMENT_MAX_BYTES` (`.env.example`) per concurrent request, which
  is the likeliest source of unbounded growth in this stack. See
  [self-hosting.md#server-sizing](docs/self-hosting.md#server-sizing) for the full per-service
  table and how the ceilings add up against the 2 GB budget. Not verified by a live run under
  the new limits — the sizing is derived from the request/attachment ceilings already documented
  in `.env.example`, not measured under load.

- **`session.cookieCache.maxAge` (`api/src/auth/auth.ts`) dropped from 5 minutes to 60
  seconds**, shrinking the window in which a browser can keep presenting a session Better Auth
  has already stopped considering valid in the database. That window is what lets a revoked
  session outlive the action that revoked it: a password change, an instance administrator
  force-deleting an account, or `Session` rows cleared to recover from a leaked `session_data`
  cookie all stayed live for up to five minutes before this change (SEC-01, 2026-08-18 audit).
  The cache itself stays on — it still saves the database read `session.cookieCache` was added
  for on every authenticated request — just for a fifth as long: at self-host scale, one DB read
  per user per minute is noise, while a 5× smaller revocation window matters on every one of
  those flows. Not exposed as an env knob on purpose; the repo already resists knob
  proliferation and nobody has asked to tune this — the trigger for adding one would be a
  deployment where the per-minute read itself measurably hurts, not a guess that one might
  exist. Every doc, comment and test that quoted the old five-minute figure — `docs/architecture.md`
  §9.2 and its `docs/tr/` mirror, ADR 0018, ADR 0022, and a one-line dated update note on
  [ADR 0026](docs/decisions/0026-account-deletion-anonymisation.md) (and their `docs/tr/`
  mirrors), plus the API/e2e/web comments and tests that referenced it — is updated to 60
  seconds alongside the code; ADR 0026's own historical narrative is left as written.

- **The `/auth/*` rate limiter degrades instead of failing open when Redis errors mid-request**
  (audit finding SEC-03). `createRedisRateLimitStorage`'s `consume()` previously answered every
  request `{ allowed: true }` on any Redis error — the comment justified it as "a Redis blip must
  not turn into nobody can sign in," but the same catch caught an outage of any length, and
  Better Auth's built-in `/sign-in*`/`/sign-up*` rule (3 per 10s) backs onto exactly this storage.
  A credential-stuffing run during a Redis outage ran completely unthrottled, at the moment an
  operator is least likely to be watching.

  Each API process now keeps a bounded, in-process fixed-window counter — mirroring the same
  window/limit the Lua script enforces against Redis, `rule.max === 0` included — and consults it
  only while Redis is erroring; a successful call goes back to Redis, but the fallback counters
  are kept rather than cleared (see below). This is a per-process floor, not the shared limit: N
  replicas each enforce the rule independently during an outage, so the effective ceiling across a
  fleet of N is the rule's limit times N rather than the rule's limit — a bounded number in place
  of the previous unbounded one, and documented as such rather than presented as equivalent to the
  Redis-backed limit. The fallback's own memory is capped at 10,000 distinct keys, and it prunes
  lazily rather than running a timer.

  The transition into and out of degraded mode is logged at error level and reported once to
  Sentry on the way down (when `SENTRY_DSN` is set), at most once per five minutes regardless of
  how many times Redis flaps between erroring and answering in between — an intermittently
  failing Redis previously logged and captured on every single flip. The fallback counters
  themselves now survive a brief recovery instead of being cleared on every flap: clearing them
  handed a flapping connection's attacker a clean slate each time it briefly recovered, which
  defeated the floor this fallback exists for.

  Eviction at the 10,000-key cap now prefers an already-expired entry over the oldest-inserted
  one, and a key's window refresh re-inserts it rather than overwriting it in place — `Map#set` on
  an existing key does not move it to the insertion-order tail, so without this a key hit
  repeatedly (a currently-blocked attacker, worst case) could look like the *oldest* entry in the
  map and be evicted ahead of keys nobody had touched in a while, handing that attacker a fresh
  window under a high-cardinality flood.

## [0.2.0] - 2026-08-16

### Changed

- **The project is now called Kurul.** `kurultay` was not available as a domain, so the name
  shortened to the word underneath it: a _kurul_ is a council, the body that convenes, decides
  and divides the work — the same idea and the same root as the _kurultay_ it was named for,
  and what the tool does for a team either way. The identity does not change with it; the
  banner, the seal and the steppe are still where the visual language comes from
  ([design.md](docs/design.md#2-identity)).

  **What this renames, beyond the label.** The npm scope (`@kurultay/*` → `@kurul/*`), the
  repository (`dravcore/kurultay` → `dravcore/kurul`), the published images
  (`ghcr.io/dravcore/kurul-api` and `-web`), the Postgres role and database, the test and CI
  databases, and the install directory the self-hosting guide uses — which is what Compose
  derives its volume prefix from.

  **For an existing v0.1.0 install this is a breaking change, and there is no in-place upgrade
  that renames a running database for you.** The step-by-step path — dump, rename the
  directory, create the new role and database, restore, verify — is in
  [self-hosting.md](docs/self-hosting.md#coming-from-kurultay-v010), including the one-line
  alternative for an operator who would rather keep the old volume names
  (`COMPOSE_PROJECT_NAME`). Take the dump before anything else: it is the only copy that
  predates the rename.

  The old repository URL keeps working — GitHub redirects it — but **the old image names do
  not become the new ones**. `docker compose pull` against `kurultay-api` will keep serving
  the last image published under that name, silently and indefinitely, which is exactly what a
  rename cannot fix for you.

### Added

- **An OpenAPI specification, generated from the running API, with a CI gate that fails when it
  drifts.** The document is served at `/openapi.json`, the interactive console at `/docs`, and a
  byte-identical copy is committed at `apps/api/openapi.json`. It covers all 49 paths and 69
  operations the NestJS router registers, with request bodies and response shapes rather than
  paths alone. `docs/api-conventions.md` remains the prose contract and gains a section pointing
  at the spec; where the two disagree, one of them is wrong and neither wins by default.

  **`/docs` is off under `NODE_ENV=production` unless `API_DOCS_ENABLED=true`, and on
  otherwise.** This API is self-hosted by people who did not choose it, so a surprise public
  surface is a decision rather than a default. The document itself leaks little — the project is
  AGPL and the routes are on GitHub — but `/docs` is an unauthenticated HTML page on a service
  that renders no documents and pins itself to `default-src 'none'`, so serving it means carving
  a Content-Security-Policy exception for one path; and its "Try it out" console issues real
  same-origin requests carrying the reader's own session cookie. Nothing is lost by defaulting
  it off: the identical document is in the repository, so the contract is readable without a
  running server.

  **The gate is what makes the committed file mean anything.** CI regenerates the document in
  the `build` job and compares it to the committed copy, returning the generator's own exit code
  rather than grepping its output — the same shape as the migration-drift check. It fires on
  more than new endpoints: because the Swagger CLI plugin derives schemas from the DTOs'
  TypeScript types and `class-validator` decorators, narrowing a `@MaxLength` or making a field
  nullable moves the document too. Both cases were measured red before the check was declared
  done.

  Response schemas are classes that `implements` the interfaces in `@kurul/shared-types`, so
  a field added to a DTO and forgotten here fails `pnpm typecheck` rather than quietly producing
  a spec that describes a shape the API no longer returns. Three facts that belong to global
  providers — the `401` from the session guard, the `429` and rate-limit headers from the
  throttler, the `500` envelope from the exception filter — are applied to every operation in
  one pass instead of being restated 69 times, and the `403`/`404` pair is attached to the
  `@WorkspaceScoped()`/`@WorkspaceRoles()` decorators themselves, so a route acquires its
  documented failures by being gated rather than by being remembered.

  The endpoints that are not plain CRUD are described as what they are: the attachment upload's
  two body shapes (`multipart/form-data` with a `file` part, or JSON for a link) and the `413`
  from `ATTACHMENT_MAX_BYTES`; the Trello import's separate `413` from `TRELLO_IMPORT_MAX_BYTES`,
  which is a heap ceiling rather than a disk one; and the byte-stream download, the one response
  in this API that is not JSON, with the five headers it writes. `/auth/*` and the Socket.io
  contract are absent and say so — neither is a Nest route.

  `ROADMAP.md` gains an **API 1.0** heading declaring the scope a compatibility promise
  would cover: a `/v1` prefix, personal access tokens, and three webhook events
  (`task.created`, `task.moved`, `task.completed`). All three are explicitly post-1.0 and none
  is implemented here.

  **One dependency override, and the reason it exists.** `@nestjs/swagger@11.4.6` pins
  `js-yaml` to exactly `5.2.1`, which carries a high-severity denial-of-service advisory
  ([GHSA-pm4m-ph32-ghv5](https://github.com/advisories/GHSA-pm4m-ph32-ghv5)) patched in
  `5.2.2` — so installing the package turned CI's own `pnpm audit --audit-level high` red before
  a line of it was used. `pnpm.overrides` lifts it to `^5.2.2`. An exact pin in a transitive
  dependency is not something a consumer can wait out, and the alternative — lowering the audit
  threshold — would have traded one library's stale pin for the whole tree's guarantee. The
  override is dropped as soon as upstream moves; `js-yaml` is what serves the YAML rendering of
  this document at `/docs-yaml`, which was exercised against the running server to check the
  substitution rather than assumed.

- **Account deletion, as an erasure request rather than a `DELETE` statement.** A user can now
  delete their own account from Settings, and an instance operator named in
  `INSTANCE_ADMIN_EMAILS` can execute a request on somebody's behalf — the case that actually
  arrives, from a person who has already lost access to the account. Until now neither was
  possible even by hand: `DELETE FROM "User"` fails on the first of **seven** `Restrict` foreign
  keys, which is the whole of audit finding DB-05
  ([ADR 0026](docs/decisions/0026-account-deletion-anonymisation.md)).

  **The `User` row is anonymised, never deleted, and no foreign key was relaxed to make that
  work.** Each of those seven `Restrict` relations is a decision that the content outlives its
  author, so the erasure rewrites the columns that identify a person — `email` to
  `deleted-<id>@deleted.invalid`, `name` to `Deleted user`, `avatarUrl` and `locale` to null —
  and everything that is also somebody else's keeps resolving. A comment thread survives with
  its structure intact and its author unnamed; the activity feed still says a change happened.
  The replacement address is derived from `User.id` and **not** from a hash of the old one: a
  hash of a known address is checkable, which makes it pseudonymisation rather than
  anonymisation. The old address is freed, so the person can sign up again as somebody new.

  **The name is copied out of the `User` row in two places, and both are rewritten.** Mention
  markup stores the display name in the comment body (`@[Ada](<id>)`), so anonymising the row
  touches none of it — every mention of the departing user becomes `@[Deleted user](<id>)`, id
  preserved so the sentence still reads. `Activity.payload` carries a person's name in exactly
  one field, `targetName`, written by the three `member.*` events; it is replaced where the
  payload is about the departing user and left alone everywhere else.

  **A workspace the user solely owns is a question the flow asks, never a default it picks.**
  `GET /me/deletion-preview` returns each such workspace with its member and board counts and
  the people who could take it over; `DELETE /me` refuses with `409` until every one of them
  carries a decision — transfer to a named member, or delete the workspace outright. A
  workspace with no other member can only be deleted, and the preview says so rather than
  leaving the client to discover it from a `404`.

  **An author DTO now says whether the person still exists.** `CommentDto.author` and
  `ActivityDto.author` carry `deleted: boolean` — the complete set of surfaces that can name an
  anonymised account, since memberships, assignments and rosters are all removed by the flow.
  The web renders a catalogue label from it (`Silinmiş kullanıcı` in Turkish) instead of the
  English `Deleted user` the database stores for API consumers. It is a boolean and not the
  `deletedAt` timestamp on purpose: both routes are readable by every member down to GUEST, and
  *when* a named person asked to be erased is a fact nothing on either screen needs. The
  display name inside a comment's mention markup stays English — that one is stored text with no
  reader's locale in scope, and it is the single place the two cannot agree.

  **The deletion leaves a record of itself.** One `account.deleted` activity row per surviving
  workspace, carrying the previous role and who initiated it and deliberately **no name** — its
  actor is the departing user, so an operator's identity never reaches a tenant's feed — plus
  one `warn` JSON log line carrying the user id and counts, and no address. Recovery, if a
  deletion was executed in error, is a restore from the nightly dump into a scratch database:
  the procedure is in
  [Undoing an account deletion](docs/development.md#undoing-an-account-deletion), including the
  clock that runs on attachment bytes once the orphan sweep's grace window passes.

  Better Auth's own `user.deleteUser` stays disabled, on purpose: it hard-deletes the `user`
  row after its hooks run, which is the exact statement those seven foreign keys exist to
  refuse. Data portability (Article 20) is explicitly not in this change.

- **Mobile navigation — the sidebar becomes a drawer below 768px.** Under the `md` breakpoint
  the app shell had one breakpoint and it was 1280px: at 360px the 56px icon rail kept its
  width, took 15% of the viewport, and could not show a workspace name in it. There was no
  mobile navigation pattern at all. A hamburger now sits in the topbar and opens the same
  sidebar in an off-canvas drawer; above 768px nothing on the desktop shell changed.

  **It is the app's `Dialog`, docked to an edge — not a second overlay.** Focus trapping,
  `Escape`, returning focus to the trigger, inerting the page behind and the scroll lock are
  the substance of an off-canvas panel, and Radix already does all of it for every other
  dialog here; a hand-rolled panel would be a second place for one of them to be missing.
  `DialogDrawerContent` is the same portal, overlay and content with different geometry, and
  the drawer and the desktop `<aside>` render one `SidebarBody`, so a nav row added to one is
  a row in both.

  **Touch targets are 44px below 768px, measured rather than asserted.** The floor lives in
  the `Button` and `Input` size variants and the dropdown item classes rather than at the call
  sites, so there is one list to read; the topbar grows to 56px to hold it, the column header
  to 48px, and the card's drag grip from 24px to 44px. `e2e/tests/mobile-navigation.spec.ts`
  sweeps every button, link, input and menu item on the board and inside the drawer at 360px
  and fails on any box under 44px in either axis — jsdom lays nothing out, so a unit test
  could only have restated the class names.

  **Touch drag works, by the grip.** The card body belongs to the column's scroller; the grip
  declares `touch-action: none` and is where the gesture reaches dnd-kit. Both halves are
  driven with real touch events in the browser: a card dragged by its grip reorders the column
  and survives a reload, and a finger dragged down the card body scrolls the column and moves
  nothing. Keyboard drag, the announcements and the skip link are unchanged and still checked.

- **A Turkish interface.** `SUPPORTED_LOCALES` is now `['en', 'tr']`, and everything keyed to
  it grew with it: `apps/web/messages/tr.json` carries all 486 keys, a new board created by a
  Turkish-speaking user seeds `Yapılacak / Devam Ediyor / Bitti`, and the two transactional
  emails — address verification and workspace invitation — are written in the recipient's
  language rather than always in English. The resolution chain, the settings picker and the
  `User.locale` column all shipped earlier with
  [ADR 0018](docs/decisions/0018-localization-strategy.md); this is the second language they
  were built for.

  **The seeded columns prove ADR 0019 rather than test it.** `Bitti` matches nothing that
  looks like `done`, and it does not need to: a column's category is stored when the column is
  written, so a Turkish board reports throughput exactly like an English one. The seed list's
  structural half — position and `ColumnCategory` — is asserted to be identical across every
  locale, so a translation can change a label and nothing else.

  **Email picks a language with no request in flight, and the interesting case is an address
  with no account.** The chain is the recipient's stored preference, then the *sender's*, then
  the `Accept-Language` of the request that triggered the send, then English. The middle link
  is a decision, not a fallback: an invitation to a new address has no preference to read, and
  the inviter is the only person in the exchange whose language is known — so a Turkish team
  invites a colleague in Turkish instead of in the server's default. A failed lookup degrades
  to the next link and is logged; it never fails the signup or the invitation behind it.

  **"100% translated" is enforced, not asserted.** `apps/web/messages/catalog.test.ts` fails
  the build on a key English has and a translation does not, on a key a translation has and
  English does not, and on a message whose ICU arguments differ between the two — driven off
  `SUPPORTED_LOCALES`, so a third language is gated the day it is declared. next-intl resolves
  a missing message to its raw key path at runtime, which is why nothing else would catch it.
  A separate test renders real screens against `tr.json`: Turkish takes one plural form where
  English takes two (`124 task`, never `124 task'lar`) and groups thousands with a dot
  (`2.000 kart`), and both come out of the running catalogue rather than out of a review.

  **For translators.** The Turkish keeps the domain nouns this project's own Turkish
  documentation keeps — `board`, `task`, `column`, `label`, `workspace`, `checklist` — and
  inflects them with an apostrophe (`board'a dön`), while translating everything with a settled
  Turkish word (`kart`, `yorum`, `davet`, `bildirim`). The four workspace roles are translated
  too — `Sahip / Yönetici / Üye / Misafir` — in the badge and in all 17 sentences that name a
  role inline, where they take Turkish case suffixes rather than the apostrophe form
  (`Bir workspace sahibinden isteyin`). The `OWNER`/`ADMIN`/`MEMBER`/`GUEST` enum values, the
  `@kurul/auth-access` identifiers and the API contract are untouched; only what a person
  reads changed. Adding a third language needs no new mechanism: a catalogue file, one row in
  `SEED_COLUMN_NAMES` and one in `MAIL_COPY`, both `Record<Locale, …>` and both compile errors
  until they exist.

- **Task attachments — files and links on a card.** A task now carries attachments of two
  kinds, and the schema says which: a `FILE` has stored bytes, a sniffed media type and a size;
  a `LINK` has only a URL. Both are first-class user features, not one plus an import artifact
  ([ADR 0022](docs/decisions/0022-attachment-storage.md),
  [ADR 0024](docs/decisions/0024-attachment-kinds-and-serving-policy.md)). The task panel
  uploads a file, attaches a link, lists what is there newest-first, previews the four image
  types inline and removes an attachment; the board card gains a count badge and renders
  nothing at all on a task with no attachments. Five endpoints were added under the workspace
  root, one of which — the byte stream — is the first response in this API that is not JSON.
  No new socket event: an attachment change emits the same `task:updated` every other task
  sub-resource uses, and the client re-reads over REST.

  **The server never requests a `LINK`'s URL.** No preview, no favicon, no `<title>` scrape,
  no unfurl, no health check — the URL is opaque text that is stored, returned and rendered by
  the client. Only `http:` and `https:` are accepted at write time. A server-side fetch of a
  user-supplied URL is an SSRF primitive, and a Compose network where `postgres` and `redis`
  resolve by name is the worst place to have one; link previews are cosmetic, the capability
  they require is not.

  **Files are accepted on their magic bytes, not their extension or their declared type.** The
  allowlist is broad — PNG/JPEG/GIF/WebP, PDF, the OpenXML and OpenDocument office formats,
  ZIP, `text/plain` and `text/csv` — and excludes `text/html` and `image/svg+xml` by name,
  because images are the one family served `inline` and both of those are markup. Plain text
  has no magic number, so `.txt` and `.csv` come in through a deliberately narrow fallback:
  the declared type must be exactly one of those two, the bytes must decode as UTF-8, contain
  no `NUL`, and not begin with `<`. Anything else is a `415`. Downloads always carry the
  sniffed type, `nosniff`, `Cross-Origin-Resource-Policy: same-origin` and a `private,
  must-revalidate` cache policy; everything except the four image types is served
  `Content-Disposition: attachment`, PDFs included.

  **Operators: three things change.** First, **the API becomes stateful** — a new
  `attachment_data` volume holds the uploaded files, the `backup` sidecar now writes **two**
  archives per cycle (the `pg_dump` and a `-files.tar.gz` sharing its timestamp), and the
  restore procedure grew a step: restoring the dump without the matching file archive brings
  the rows back and leaves every file behind, which passes every check written before
  attachments existed. The rehearsed drill in
  [development.md](docs/development.md#restoring-from-a-backup) now compares file count **and**
  per-file size against the rows. Second, **the reverse-proxy contract gains a body-size row,
  and its number is deliberately not the same as the user-facing limit**:
  `ATTACHMENT_MAX_BYTES` is `26214400` (25 MiB) and is the size of the _file_, while the proxy
  caps the _whole request body_ at 26 MiB, because a multipart envelope adds a few hundred
  bytes on top — set both to 25 MiB and a file of exactly the documented limit becomes
  unuploadable. The rule between them is an ordering, not an equality: the proxy must never
  reject what the API would accept. A replacement proxy that omits the row rejects everything
  over nginx's 1 MB default. Third, **the nightly retention sweep now also unlinks stored files
  no attachment row claims**, after a grace period of `BACKUP_KEEP × BACKUP_INTERVAL` (floored
  at 24 hours) — which is why those two variables are now passed to the `api` service as well
  as to `backup`. Attachments are off entirely unless `STORAGE_PATH` is set; links work either
  way, and `GET /config` reports `attachmentsEnabled` so the UI can say so.

  **One audit-query note.** `AUDIT_ACTIVITY_TYPES` grew by one entry, `attachment.deleted`, so
  the administrative activity query returns a type it did not before — on the singular path
  only, one person detaching one file. `attachment.created` was deliberately left **out** of
  that subset: the Trello importer will write one attachment row per imported URL, which is
  the bulk-volume behaviour the audit list excludes `comment.created` for. The upload is still
  on the task's own activity feed either way.

- **Task checklists.** A task can now carry multiple named checklists, each with its own items
  — the shape Trello uses, chosen because Trello import (P3-3, the next roadmap item) targets a
  source that is itself multi-list, and because a single flat list would need re-modelling the
  moment that importer landed ([ADR 0023](docs/decisions/0023-checklist-data-model.md)). The
  task panel adds and removes checklists, adds and removes items, and ticks items off; the
  board card shows a `done/total` badge and renders nothing at all on a task with no checklist.
  Completion is counted at read time from whichever items are loaded — never stored on the task
  — so a board badge can't drift out of sync with the items it summarizes. No new socket event
  was added: a checklist or item change calls the same `TaskEventsService.emitUpdated` every
  other task sub-resource already uses, so `task:updated` plus a REST re-read carries it, the
  same way label changes do. `Checklist.position` and `ChecklistItem.position` follow every
  other position field in the schema — `Float`, fractional-indexed — and the API exposes a move
  endpoint for each, but **the panel does not yet offer drag-and-drop reordering for checklists
  or items**; only creation, deletion and toggling are wired up on the client. Subtasks — a
  task-shaped child with its own board column, position and assignee — remain out of scope:
  ADR 0023 treats that as a different data model from a checklist item, not a deeper one.

- **Trello board import, one-way.** A workspace admin uploads a Trello board's JSON export at
  `POST /workspaces/:workspaceId/imports/trello` and gets a new board: lists become columns,
  cards become tasks, labels fold onto the eight design-token colour slots, and Trello's
  checklists arrive as checklists — one Kurul list per Trello list, unflattened, which is the
  shape [ADR 0023](docs/decisions/0023-checklist-data-model.md) chose in advance for exactly this
  ([ADR 0025](docs/decisions/0025-trello-import-mapping.md)). The board list gains an "Import from
  Trello" entry; the report comes back in the response and is rendered as a panel that stays until
  it is dismissed.

  **It is not idempotent, and that is a decision rather than a gap.** Importing the same export
  twice creates **two boards** — there is no dedupe key, no update-in-place and no "already
  imported" answer, because updating an existing board is synchronisation rather than import and
  needs a conflict policy, a deletion policy and a direction. The dialog says so before the upload
  and a test pins the behaviour, so anyone who adds deduplication has to read the record first.

  **Four things deliberately do not come across, and the report counts every one of them rather
  than dropping them silently.** *Files*: a Trello export carries attachment URLs, not bytes, so
  every attachment becomes a `LINK` row — and the server never requests those URLs, the same SSRF
  rule the attachment feature already follows. *Members*: a Trello account is not a Kurul
  account, so assignments are dropped and every row written — tasks and attachments alike — is
  attributed to the person who ran the import. *Comments*: out of scope for this pass. *Archived
  lists and cards*: Kurul has no archive, and importing what a user deliberately filed away
  would be the wrong default. Alongside them the report also carries what came across *changed*:
  **every imported column arrives `UNSTARTED`**, because [ADR 0019](docs/decisions/0019-column-category.md)
  refuses to infer completion from a column's name or its position and a Trello list carries
  neither — so the panel says how many columns are waiting and links to where they are set. On an
  imported board no column means "done" until someone says so, which means the dashboard's
  completion figures read zero until then.

  **The write is atomic; the coverage is partial.** Reading and mapping happen in two pure
  functions before the transaction opens, so a malformed export costs a `400` and writes nothing —
  there is no half-imported board, and no "skip this one and carry on" inside the transaction. The
  report is the body of the `201` and **is not stored anywhere**: no `ImportRun` table, no status
  endpoint, no way to ask for it again. Dismissing the panel is permanent; the board is unaffected.
  One activity row is written per import (`board.imported`, new in `AUDIT_ACTIVITY_TYPES`), not one
  per card, and no socket event is emitted at all — a new board's room has nobody in it yet.

  **Operators: one new variable.** `TRELLO_IMPORT_MAX_BYTES` (default `20971520`, 20 MiB) is the
  largest export the importer will accept. It is a **memory** ceiling rather than a disk one — the
  body is buffered and `JSON.parse`d and the parsed graph is a multiple of the bytes — which is why
  it is a separate number from `ATTACHMENT_MAX_BYTES` and not derived from it, and why raising it
  raises peak heap by a multiple of the change. It must stay below the reverse proxy's body limit;
  `two-layer-limit.spec.ts` fails the build if it stops doing so. Import needs no `STORAGE_PATH`:
  it stores no bytes. The endpoint is admin-only (creating columns is, so creating a board *and*
  its columns in one request is too) and rate-limited to **3 requests a minute**, well under the
  upload budget because one request costs a 20 MiB parse plus the longest-lived write transaction
  in this API.

  **What was measured, and what was not.** A generated 500-card export imported in a **median of
  572.9 ms and a p95 of 655.8 ms** over five runs on an Apple M3 Max, against a local API and
  Postgres over loopback — no reverse proxy, no container, no network between the client and the
  API. That is comfortably inside the two-minute budget the roadmap asked for, but it is a floor
  rather than a prediction for a real deployment. Schema conformance is the part that was **not**
  measured: no real Trello export was available, so every fixture is synthetic and nothing here is
  evidence about Trello's actual export format, whose schema has no version field and no
  changelog. The reader is written for that — an unrecognised field is counted into the report
  instead of failing the import — but the first genuine export remains the most likely place for
  it to break.

- **An activation funnel you can read about your own instance, and telemetry that is off.**
  Kurul measured nothing about its own use — a grep for `telemetry`, `analytics`, `posthog`,
  `plausible` or `umami` across `apps/` and `docs/` returned zero matches in source — so where
  onboarding broke, whether invitations converted, and whether anyone used this as a *team* were
  all answered by intuition (audit finding PM-07). Two layers now exist, decided separately.
  **The funnel is instance-local and nothing about it ever leaves your server:** eleven steps
  (`user_registered`, `workspace_created`, `board_created`, `first_task_created`, `first_drag`,
  `invite_sent`, `smtp_configured`, `invite_accepted`, `dashboard_viewed`, `task_completed`,
  `wau_board_view`) plus a North Star — **Weekly Active Team Workspaces**, workspaces with 2+
  members where 2+ current members were active in the last seven days — computed on demand at
  `GET /instance/activation` and rendered at the bottom of Settings. Nine of the eleven are
  *derived* from `Activity`, `User` and `WorkspaceMember`, so the funnel covers an instance's
  whole history rather than starting flat at the deploy, and no new write path was added to any
  request that creates or moves anything. Every step counts distinct people, never events;
  `smtp_configured` is the one exception and sits between "invite sent" and "invite accepted"
  because without a mail transport an invitee cannot accept at all (ADR 0013), so a zero there
  explains a drop that would otherwise read as a product problem. Reading it requires the new
  `INSTANCE_ADMIN_EMAILS`, **blank by default, which means nobody** — including the account that
  owns every workspace on the box, because on an install with open registration "owner of a
  workspace" is a role any visitor can grant themselves. **Outbound telemetry is opt-in and off:**
  `TELEMETRY_ENABLED=false` is the default and sends nothing at all; switching it on *and*
  naming a `TELEMETRY_ENDPOINT` (no default — there is deliberately no built-in collector
  address) sends exactly one POST at process start carrying
  `{"event":"instance_started","version":"0.1.0"}` and nothing else — no instance identifier, no
  hostname, no IP, no counts, no part of the funnel, nothing about any person — logged in full
  before it is sent, never retried, and unable to delay or fail a boot. `docs/development.md`
  (EN + TR) lists the payload field by field; the reasoning, including why the ping carries no
  instance id and therefore counts starts rather than installs, is
  [ADR 0021](docs/decisions/0021-activation-funnel-and-opt-in-telemetry.md). Closes audit
  finding PM-07 ([#128](https://github.com/dravcore/kurul/issues/128)).

- **Administrative actions now leave an audit trail.** `Activity` recorded only what happened to
  cards and comments, so board, column and label creation and deletion, workspace renames,
  member removals, role changes and the whole invitation lifecycle passed through the API
  without leaving a trace. After a compromised account or a bad departure there was no way to
  answer "who deleted that, and who gave them the role that let them" (audit finding SEC-05).
  Seventeen event types are now written — `board.*`, `column.*`, `label.*`, `workspace.updated`,
  `member.removed` / `member.left` / `member.role_changed`, `invitation.created` /
  `invitation.revoked` / `invitation.accepted` — each carrying the actor, the target, and both
  sides of every changed field, so a role change records the role that was held as well as the
  one that was granted, and a deleted board records the name and task count that stop existing
  with it. Deletions are written inside the transaction that performs them, before the delete,
  so a refused delete leaves no entry and a successful one cannot lose its record. No payload
  widens who can read something: the activity feed is readable by every member down to GUEST,
  while the pending-invitation list is admin-only, so `invitation.*` entries record the
  invitation id and role and never the invited address — an admin joins `WorkspaceInvitation`
  for that. `AUDIT_ACTIVITY_TYPES` in `@kurul/shared-types` makes the whole question a single
  tenant-scoped query. Workspace *deletion* is the one act that cannot be stored this way —
  `Activity` cascades on `workspaceId`, so the row would delete itself — and is emitted on the
  JSON-line log instead, as a `workspace.deleted` event carrying the name, slug, member count
  and board count gathered before the delete.
- **Browser end-to-end suite (Playwright)** — a new repository-level `e2e/` package runs four
  scenarios against a real Chromium, a compiled API and a production web build: sign in → open
  a board → drag a card → **reload and find it still moved**; a move made in one browser
  appearing in a **second browser** with no reload; an invitation sent from the settings dialog
  → read out of **Mailpit** → accepted from the link in the message; and clicking a
  notification opening **the task it refers to**. These four were the largest single gap in the
  project's testing: the unit suites and the API integration suite all pass against a board
  that never renders, and until now nothing exercised drag-and-drop, Socket.io, mail delivery
  or notification navigation in a browser at all. Two more scenarios arrived later in this same
  release, each with the feature it covers — an attachment uploaded and downloaded back, and a
  Trello export imported from a real file picker — bringing the suite to **six**. Scope is capped
  on purpose and the run is capped at five minutes by `globalTimeout` — this suite exists to notice
  when the *stack* comes apart, not to re-check the layers below it. Setup is done over HTTP and only the
  behaviour under test is clicked; there are no `data-testid` attributes (columns are
  `<section aria-label>`, cards carry `aria-label="Reorder <title>"` on their grip), no fixed
  waits, and no retries — including in CI. Each of the original four was verified by breaking the
  thing it protects and confirming it goes red; the two added since carry the same guarantee in a
  cheaper form, asserting the absence before the presence in every case. It runs in its own workflow
  (`.github/workflows/e2e.yml`) nightly and on pull requests into `main` — i.e. before every
  release and hotfix — deliberately **outside** the required `ci-ok` gate, so an infrastructure
  hiccup in a full-stack browser run can never block every merge in the repository. The suite
  isolates itself completely: ports 3110/4110, database `kurul_test_playwright`, no Redis at
  all, and no new environment variables (the Postgres connection is derived from `DATABASE_URL`
  with only the database name swapped). A Redis logical database index was the obvious boundary
  and does not hold — `parseRedisUrl` drops the URL's pathname, so `redis://…/8` reaches database
  0 ([#190](https://github.com/dravcore/kurul/issues/190)) — so the suite runs the API with no
  Redis, which it supports, and which is the only option here that is isolated rather than merely
  documented as such. Run
  it with `pnpm test:browser`. Closes audit finding QA-01
  ([#129](https://github.com/dravcore/kurul/issues/129)); `docs/testing.md` (EN + TR) now
  names these flows as the concrete definition of the "critical flows later" it had been
  reserving Playwright for.
- **One image, any domain — and a one-page guide for putting it on yours.** The published
  `web` image no longer has a deployment's API URL compiled into it, so
  `docker compose pull && docker compose up -d` now works on `kurul.example.com` exactly as
  it does on `localhost`, with no rebuild. Verified by running two independent stacks from the
  same image ID side by side on two hostnames — sign-up, email verification, boards and the
  realtime WebSocket all working on both. Closes audit finding PM-02
  ([#119](https://github.com/dravcore/kurul/issues/119)).
  - `docker-compose.yml` gains a **`proxy` service (Caddy)** that is now the stack's only
    published entrance. It serves the web app and the API from one origin — `/auth/*` and
    `/api/*` to `api`, everything else to `web` — with automatic HTTPS once a domain is set.
    Its routing contract, and why the two API rules differ, is documented in `docker/Caddyfile`
    for anyone replacing it with their own proxy.
  - **`SITE_URL`** is the new (compose-only) `.env` variable for that origin, scheme included:
    `http://localhost` by default, `https://kurul.example.com` to go live. The API's
    `WEB_URL` and `BETTER_AUTH_URL` are derived from it, so app, API and cookies agree on one
    origin without three variables to keep in sync.
  - **New guide: `docs/self-hosting.md`** (EN + TR) — DNS, HTTPS, SMTP, backups, upgrades,
    bring-your-own-reverse-proxy and troubleshooting, on one page.
- **`INTERNAL_API_URL`** — the absolute API address the web *server* uses for its auth
  middleware and server-side rendering, since a same-origin `/api` has no origin to resolve
  against inside Node. Unlike `NEXT_PUBLIC_*` it is read at container start, and
  `docker-compose.yml` points it straight at `http://api:4000` over the container network, so a
  server render never leaves the compose network.

- **Register form now shows field-level error messages** — when sign-up fails, the error is no
  longer reported as a generic "could not create your account" message. Better Auth error codes
  like `PASSWORD_TOO_SHORT` and `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` now map to their
  relevant field (password, email) with a message that tells the user exactly what to fix.
  Unknown errors fall back to the generic message to avoid leaking unnecessary details.
- **GHCR image publishing** — `.github/workflows/release-images.yml` builds and pushes
  `ghcr.io/dravcore/kurul-api` and `ghcr.io/dravcore/kurul-web` (`linux/amd64` +
  `linux/arm64`, tagged with the release's SemVer, its `major.minor`, and `latest`) on every
  `vX.Y.Z` tag push. `docker-compose.yml`'s `api`/`web` services now declare `image:
  ghcr.io/dravcore/kurul-{api,web}:${TAG:-latest}` alongside their existing `build:`, so
  `docker compose pull && docker compose up -d` installs and upgrades from a published image
  with no local build — falling back to `build:` automatically (same source build as before)
  when no image exists for the configured `TAG` or the registry is unreachable. `TAG` is a new
  compose-only `.env` variable (see `.env.example`) for pinning a specific release instead of
  tracking `latest`. `migrate` (the one-shot migration runner) still always builds from source
  — see the comment beside it in `docker-compose.yml` for why that's scoped out of this change.
  Closes audit finding OPS-04 ([#126](https://github.com/dravcore/kurul/issues/126)); README (EN + TR)
  and `docs/development.md` (EN + TR) now document the pull-based flow as the default, with
  `docker compose up --build` kept as the explicit build-on-purpose path.
- `SEED_LARGE_BOARD_TASKS` — `pnpm db:seed` can now build a board of arbitrary size next to the
  four-task demo one (`SEED_LARGE_BOARD_TASKS=1000 pnpm db:seed`). Blank or `0`, the default,
  skips it, so the everyday seed is unchanged. The rows are deliberately uneven — five columns
  with the largest holding about a third of them, mixed priorities, labels on half the cards,
  assignees on a quarter, due dates spread across and past the due-soon window — because a
  board where every card is the same shape measures one shape of card. This is what the board
  render budget below was measured against. See
  [docs/development.md](docs/development.md#seeding-a-large-board).
- A **Workspace** section in Settings — renaming and deleting a workspace no longer require
  `curl`. `PATCH /workspaces/:workspaceId` and `DELETE /workspaces/:workspaceId` existed from
  the start, but nothing in the product called either. Rename (OWNER/ADMIN, matching the
  endpoint's own `@WorkspaceRoles` gate) only ever sends `name` — `slug` stays untouched,
  because nothing under `apps/web/app/(app)` resolves a route or a link by it, so a slug
  editor here would be a control with no visible effect. Delete (OWNER only) requires typing
  the workspace's exact name before the button will accept a click: the cascade behind it
  (audit finding DB-06) removes every board, column, task, and comment in one statement, with
  no soft-delete stage and no automated backup to fall back on, so a single "Delete this
  workspace?" click is not proportionate friction for an unrecoverable action. Deleting clears
  the session's active workspace the same way `Leave workspace` does — dropping the socket and
  redirecting to the dashboard — because the workspace this whole screen was scoped to no
  longer exists to redirect back into. All copy is catalogued under `app.settings.workspace.*`.
- **The product now says when it cannot send email.** A deployment with no `SMTP_HOST`
  delivers nothing, so nobody can confirm an address and therefore nobody can accept an
  invitation — a deliberate security trade-off (ADR 0013, GHSA-fmh4-wcc4-5jm3) that the
  product used to keep entirely to itself: the admin sent an invitation, the API answered
  `201`, the message went to a log file, and the only visible outcome was an invitation nobody
  ever accepted. Two new signals close that. `GET /config` — a new instance capability
  document, session-required, deliberately not part of the liveness probe — reports
  `mailEnabled`, and Settings → Members turns `false` into a standing, non-dismissable notice
  that names the constraint, links to the SMTP setup guide, and points at the **Copy link**
  control that still works. `POST /workspaces/:workspaceId/invitations` now also reports
  `emailDelivery` (`SENT` / `NOT_CONFIGURED` / `FAILED`) for the invitation it just created,
  so an admin is told at the moment they send it rather than by a teammate who never got an
  email; the field is absent when no send was observed, which is deliberately not the same as
  `SENT`. Both values derive from the transport the mail module actually selected — nothing
  reads `SMTP_HOST` a second time — so the UI and the log can no longer disagree about the
  same deployment. Sending is still not a precondition of anything: the invitation is created
  either way.
- A **Members** section in Settings — the product can now start the flow it is built around.
  Every membership endpoint already existed; none of them had a screen, so inviting a teammate
  meant a `curl` call and the accept page served invitations nobody could send. Settings now
  carries the whole lifecycle: an email + role invite form, the queue of invitations still
  waiting to be accepted (with a copy-link control for installs whose outbound mail is not
  configured yet, and revoke), the roster with role changes and removal, and **Leave
  workspace** on the signed-in user's own row. What the API refuses, the UI does not offer: a
  MEMBER sees the roster and no management control at all, an ADMIN sees no menu on an OWNER's
  row, and OWNER is never an invitable role. The refusals that remain are stated as the move
  that would work — the last-OWNER `409` reads "This is the only owner. Make someone else an
  owner first." rather than a generic failure. All copy is catalogued under
  `app.settings.members.*`.
- `GET /workspaces/:workspaceId/invitations` — a cursor page of the invitations still awaiting
  an answer, so an admin can see and withdraw what they sent. OWNER/ADMIN only, unlike the
  roster beside it: an invited address belongs to someone who has agreed to nothing yet, and a
  GUEST reading the queue would be handed contact details the product never showed them.
  Expired and already-answered invitations are left out — the list is for rows something can
  still be done to.
- A data-retention policy, and a nightly job that enforces it. Until now nothing in the
  product ever deleted a row on its own: expired `Session` rows kept their `ipAddress` and
  `userAgent` forever, expired `Verification` rows kept the e-mail address that requested
  them, and `Notification` and `Activity` — the two fastest-growing tables in the schema —
  grew without a ceiling. A BullMQ job on `REDIS_URL` now runs once a day and deletes expired
  sessions and verifications (their own `expiresAt` decides), notifications more than
  `NOTIFICATION_RETENTION_DAYS` past the moment they were **read** (default 90; unread
  notifications are never deleted, at any age), and activity older than
  `ACTIVITY_RETENTION_DAYS` (default 365). Either window accepts `0` for "keep forever", and
  `CLEANUP_ENABLED=false` switches the whole sweep off — checked at the point of deletion, so
  a job definition left in Redis by an earlier deployment cannot outlive the switch. Deletes
  are batched at 1000 rows per statement so a first run against a long-lived instance is not
  one long transaction holding locks and blocking autovacuum. Each run writes one JSON line to
  stdout carrying the per-table counts and nothing else — no identifiers, no payloads — even
  when every count is zero, so a job that stops running is visible by its silence. The sweep
  is deliberately global rather than workspace-scoped, which is the single sanctioned
  exception to the multi-tenant rule and is argued in the new
  [ADR 0020](docs/decisions/0020-data-retention.md) along with the choice to delete year-old
  activity rather than archive or keep it. One index came with it
  (`Notification_activityId_idx`): `activityId` is `ON DELETE SET NULL`, which Postgres runs
  per deleted row, so without it each batch of deleted activities meant one sequential scan of
  the whole notification table per row.
- The web app now sends the same class of baseline security headers the API already did
  (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`), via
  `apps/web/next.config.ts`'s `headers()`. Unlike the API's `default-src 'none'` — it renders
  no HTML — the web CSP is shaped for a real App Router application: `script-src`/`style-src`
  allow `'unsafe-inline'`, verified empirically to be required (Next's RSC hydration script and
  `next-themes`'s FOUC-prevention script are both inline, and Radix/`@dnd-kit` position
  elements via an inline `style` attribute CSP nonces cannot cover), and `connect-src` names
  the configured API origin plus its derived `ws(s)` origin so both the REST client and the
  Socket.io transport keep working. `Permissions-Policy` denies `camera`, `microphone`,
  `geolocation`, `payment`, `usb`, and `interest-cohort` (FLoC/Topics-API opt-out) — none of
  which the app ever requests. See `docs/architecture.md#11-security-headers` for the full
  header table across both processes.
- Bounded timeouts on the shared database connection pool (`apps/api/src/prisma/database.ts`):
  `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (default `10000`) caps how long a request waits for a
  connection once the pool is at `DATABASE_POOL_MAX`, and `DATABASE_STATEMENT_TIMEOUT_MS`
  (default `30000`) caps how long a single statement may run before Postgres kills it. Neither
  existed before: `pg`'s own default for the former is `0` (wait forever), so a saturated pool
  turned into requests that never resolved instead of a clear error, and with no statement cap
  a runaway query could hold a connection indefinitely. Applied per connection this pool opens,
  so `prisma migrate deploy`/`dev` and `pnpm db:seed`'s own bulk operations — neither goes
  through this pool — are unaffected. `DATABASE_POOL_MAX` itself (already the pool's size knob)
  is now also documented in `.env.example` and `docs/development.md`, which it previously was
  not. See [docs/development.md#database-connection-pool](docs/development.md#database-connection-pool).
- Observability baseline — until now a production failure or outage was only discovered when
  a user complained, and container logs grew without a ceiling until the disk filled. Three
  pieces close that, none of which is a metrics stack:
  - **Error tracking via Sentry, off by default.** With `SENTRY_DSN` (API) and
    `NEXT_PUBLIC_SENTRY_DSN` (web) blank — the shipped default — neither app loads the SDK at
    all: no initialization, no global handlers, no outbound connection, and no Sentry chunk
    requested by a visitor's browser. Turning it on is a deliberate, documented choice, and
    self-hosted Sentry works the same way. The API reports 5xx only (4xx client errors are
    noise, and are already in the access log), every event carries the request's `requestId`
    tag so a Sentry issue and a log line join with one grep, and `release`/`environment` are
    settable via `SENTRY_RELEASE`/`SENTRY_ENVIRONMENT`. `sendDefaultPii` is off and a
    `beforeSend` hook additionally strips cookie/authorization headers, cookies, request
    bodies, query strings, and everything on `user` except the opaque id. Performance tracing
    and Session Replay are pinned off and not exposed as settings. The web build plugin runs
    only when a DSN is configured and uploads source maps only when `SENTRY_AUTH_TOKEN` is
    also present, so a token-less build never fails.
  - **Log rotation on every compose service.** Docker's `json-file` driver is unbounded by
    default; every service in `docker-compose.yml` and `docker-compose.dev.yml` now caps at
    3 files × 10 MB via a shared `x-logging` anchor. This applies at container *creation*, so
    an existing deployment needs `docker compose up -d` (not a plain restart) to pick it up.
  - **An uptime-monitoring procedure** in `docs/development.md#observability`: which endpoint
    to poll (`/health/ready`, not `/health` — the liveness probe stays green while the
    database is down, by design), at what interval and threshold, and how to verify the alert
    actually fires. The monitor itself lives outside this repository, in a free external
    service.
- Membership revocation — the half of the access lifecycle that was missing. Until now a user
  who joined a workspace could only be removed by deleting the workspace or editing the
  database by hand, and no role could be lowered. Three routes close that:
  `DELETE /workspaces/:workspaceId/members/:userId` and
  `PATCH /workspaces/:workspaceId/members/:userId/role` (both OWNER/ADMIN), and
  `POST /workspaces/:workspaceId/members/me/leave`, which every member may call for
  themselves at any role. A workspace can never be left without an OWNER: the last one cannot
  be removed, demoted or allowed to leave (`409`), an ADMIN can neither remove an OWNER nor
  change their role, and only an OWNER may promote someone to OWNER (`403`). Removal is
  addressed at another member — taking yourself out is `POST .../members/me/leave`, so an
  admin's mistake cannot lock the admin out. Access ends immediately in both directions: the
  next HTTP request from a removed member is a `404`, and their Socket.io board and
  notification rooms are dropped inside the same request, so no board or notification event
  reaches them afterwards. The Better Auth `/organization/*` HTTP paths these routes replace
  stay blocked at the mount, as before.
- Scheduled database backups with a rehearsed restore path. `docker compose up` now starts a
  `backup` sidecar (`postgres:18-alpine`, `restart: unless-stopped`, waits for a healthy
  `postgres`) that runs `scripts/backup.sh`: every `BACKUP_INTERVAL` seconds it writes a
  `pg_dump --format=custom` archive to `/backups/kurul-<UTC timestamp>.dump` in the new
  `backup_data` volume — via a `.part` file renamed on success, so an interrupted dump never
  looks like a finished archive — and prunes to the newest `BACKUP_KEEP` archives. The
  defaults (`86400`/`7`, both compose-only settings in `.env.example`) give a recovery point
  at most 24 hours old and a week of history on a self-hosted instance that nobody has to
  remember to back up. `docker-compose.dev.yml` is deliberately unchanged. The restore
  procedure in `docs/development.md` is now step-by-step and was rehearsed end to end —
  a seeded database dumped by the script and restored with `pg_restore` into an empty server
  reproduced all 17 tables, every row count, all 59 indexes, `pg_trgm`, and
  `_prisma_migrations` — with stated RPO ≤ 24 h / RTO ≤ 2 h targets and a warning that a
  volume on the same disk is not disaster protection.
- Structured HTTP access logging and request correlation. Every request is assigned an id —
  a safe inbound `X-Request-Id` is reused so an id minted by a proxy survives, anything else
  is replaced by a generated UUIDv7 — and it comes back in the `X-Request-Id` response
  header. Each finished request writes one JSON line to stdout
  (`{ts, level, requestId, method, path, status, durationMs, userId?}`); bodies, query
  strings, headers and cookies are never logged. The same id is appended to 5xx log lines
  and returned as `requestId` in the error envelope, so a reported failure names exactly one
  request. Both middlewares run ahead of the Better Auth mount, which bypasses the Nest
  router, so sign-in traffic and unmatched routes are logged too.
- `GET /health/ready` — an unauthenticated readiness probe that checks Postgres (`SELECT 1`)
  and Redis (`PING`) in parallel, each bounded by a 2s timeout so a wedged dependency answers
  `down` instead of leaving the probe hanging. `200` when the instance can serve traffic,
  `503` when it cannot, with the same `{ status, checks }` body either way so the caller can
  see which dependency failed. Redis reports `skipped` where `REDIS_URL` is unset, which is a
  supported single-instance configuration and does not make the instance unready. `GET /health`
  stays exactly as it was — liveness, dependency-free, so a dependency blip never gets a
  healthy API restarted.

### Changed

- **The two API images lost 2.8 GB between them, without dropping a dependency the app uses.**
  Summing `docker history` on `linux/arm64`: the `api` runtime image went from 955 MB to
  407 MB, and the one-shot `migrate` image from 2663 MB to 418 MB (audit finding OPS-07). As
  unpacked bytes on disk, the same two images went from 1.22 GB to 516 MB and from 3.37 GB to
  538 MB; compressed, from 266 MB to 108 MB and from 705 MB to 120 MB. All three readings are
  in `docs/development.md`, because they are far enough apart that quoting one alone would be
  choosing a flattering number.

  Most of the API image was never reachable code. `pnpm deploy --prod` prunes the deployed
  package's own `devDependencies` but keeps _optional peer dependencies_ — peers the publishing
  package itself marked `"optional": true`, which pnpm's `auto-install-peers` had resolved
  anyway. `better-auth` declares those on `next`, `react`, `react-dom`, `svelte`, `vue`,
  `solid-js`, `drizzle-orm`, `mongodb`, `mysql2`, `better-sqlite3` and `vitest`;
  `@prisma/client` declares them on `prisma` and `typescript`. Following those edges shipped
  `@next/swc-linux-arm64-{gnu,musl}` (169 MB), `@prisma/studio-core`, `@electric-sql/pglite`,
  `@prisma/engines`, `sharp`'s libvips builds, Playwright, `vite`, `rollup`, `esbuild` and the
  TypeScript compiler into an image whose only job is to run `node dist/main.js`.
  `scripts/prune-deployed-modules.mjs` now removes them: it walks `dependencies`,
  `optionalDependencies` and non-optional `peerDependencies` from the deploy's top level and
  deletes every virtual-store entry the closure does not contain. In pnpm's isolated layout
  those entries are off the primary resolution path, so this is not a judgement about which code
  "probably" runs — 269 of 493 store entries went, and 212 MB of `node_modules` remained.

  The residual risk, named in the script's header rather than left for someone to discover: a
  package that `require`s something it never declared used to resolve through pnpm's flat
  `.pnpm/node_modules` hoist, and no longer will. A manifest-only walk cannot see that, and it
  fails at runtime rather than at build. The mitigation is empirical — the healthcheck, the e2e
  suite, and a boot with the three opt-in paths that load code no default boot touches:
  `SENTRY_DSN` set (SDK initialises with 44 integrations, `flush()` returns), `SMTP_HOST` set
  (a real invitation arrives in Mailpit over SMTP), and `REDIS_URL` set (BullMQ schedulers and
  the Socket.io Redis adapter both register). All three were exercised against the pruned image.

  `migrate` was the bigger number and the simpler fix: the stage was `FROM build`, so the
  image was the entire assembled workspace — every dev dependency of every package, the
  sources, and pnpm — kept alive to run one command. It now starts from the same clean
  `node:24-alpine` the API does and carries the Prisma CLI, `prisma.config.ts`, the schema and
  the migrations. It also drops root: the old stage ran as root only because it inherited no
  `USER` from `build`, and `prisma migrate deploy` never needed one. Both images run as
  `USER node`, as before for `api` and newly so for `migrate`.

  Nothing about the compose contract moved: `docker compose up -d` still brings the stack up
  with `migrate` at `Exited (0)` and `api` `(healthy)`, `/health/ready` answers 200 through the
  proxy, and the web image is untouched — no build-time API URL was reintroduced.
- **"`develop` is always deployable to staging" is gone, replaced by a claim something checks.**
  `docs/git-strategy.md` had promised that since the branch table was written, and no staging
  environment has ever existed — no host, no workflow, no secret in this repository points at
  one (audit finding OPS-08). A standing promise nothing enforces is worse than no promise,
  because it is quoted as though it were a safety net. The table now says `develop` must
  **start**, which is verifiable, and the release process gained the verification as part of
  step 4: `docker compose up -d --build`, `docker compose ps -a`, `curl` the readiness endpoint,
  `docker compose down -v`. It is deliberately a release-time step rather than a CI job — a full
  compose boot on every pull request costs more than it catches — and it runs the same stack a
  self-hoster runs, `SITE_URL` at its `http://localhost` default, so what is checked is the real
  deployment shape and not a staging-only approximation. Step numbering is unchanged; the boot
  and the release PR share step 4.
- **`docs/self-hosting.md` now covers the host, not just the stack.** The guide arrived with
  automatic HTTPS but said nothing about what the machine around it should allow: it now states
  the inbound firewall rule (SSH, 80, 443 and nothing else), why the rest of the stack is
  already private without one (`proxy` is the only service in `docker-compose.yml` with a
  `ports:` entry — everything else is on Docker's internal network, checkable with
  `docker compose ps`), and the trap that makes a firewall alone insufficient on Linux: Docker
  publishes ports through its own iptables rules, which are consulted before ufw's, so a port
  published in an override is internet-facing despite a `ufw deny` covering it. Verifying the
  deployment also no longer stops at "the page loads" — step 4 checks the thing HTTPS was for,
  by reading the session cookie back. `SITE_URL=https://…` yields
  `__Secure-better-auth.session_token=…; HttpOnly; Secure; SameSite=Lax`; the same request under
  `SITE_URL=http://…` yields `better-auth.session_token=…; HttpOnly; SameSite=Lax`, no prefix
  and no `Secure`, with the session token crossing the network in clear text. Both measured on a
  running stack. Better Auth derives both properties from the scheme of the URL it is configured
  with, which makes the scheme in `SITE_URL` the single switch behind them — now stated where an
  operator will read it, along with what the wrong answer looks like.
- **The nightly retention sweep now covers a fifth table.** `UsagePing` — the deduplicated
  "somebody opened a board / the dashboard" rows the activation funnel above needed — is swept
  under the existing `ACTIVITY_RETENTION_DAYS` rather than growing a window of its own: it is
  the same class of row (instance history naming a user), and two settings on one class of data
  can only ever disagree with each other. `0` still means "keep forever" for both. The job's
  nightly JSON log line gains a `usagePings` count alongside the four it already carried; it is
  still counts only, with nothing from the rows themselves.
- **`api` and `web` no longer publish host ports in `docker-compose.yml`.** Both are reached
  through the new `proxy` service on port 80/443, so a Docker install is now at
  `http://localhost`, not `http://localhost:3000`. This closes a real gap rather than just
  tidying: with no route around the proxy, the API's `TRUST_PROXY` can be fixed at `1` (it is),
  which restores the per-client rate-limit buckets and access-log IPs that would otherwise have
  collapsed onto the proxy's own container address. `docker-compose.dev.yml` and the `pnpm dev`
  loop are unchanged — they still run the two apps on `:3000`/`:4000` as separate origins.
- **The `web` image bakes `NEXT_PUBLIC_API_URL=/api`** instead of `http://localhost:4000`, and
  the variable was removed from `docker-compose.yml`'s build `args:` so a local
  `docker compose build web` produces the same bundle as the release image rather than baking
  whatever the dev loop left in `.env`. Next.js still inlines `NEXT_PUBLIC_*` at build time —
  that cannot change — but the value being inlined is now correct on every domain. A deployment
  that wants the API on its own hostname can still build with
  `--build-arg NEXT_PUBLIC_API_URL=https://api.example.com` and accept a domain-specific image.
- The web app's CSP `connect-src` collapses to `'self'` for a same-origin API instead of naming
  an origin and a derived `ws(s)://` one. `'self'` covers the same-origin WebSocket upgrade
  (CSP Level 3), confirmed in a browser against the real stack rather than taken from the
  spec — had it not, Socket.io would have quietly fallen back to its polling transport.

  **Upgrading an existing Docker install:** set `SITE_URL` in `.env` (`http://localhost` keeps
  today's behaviour, on the standard port), then `docker compose pull && docker compose up -d`.
  `WEB_URL` and `BETTER_AUTH_URL` in `.env` no longer affect the compose stack — they belong to
  the dev loop now — so a deployment that set them must move that value to `SITE_URL`. If port
  80 is taken on your host, override `proxy`'s `ports:` rather than re-publishing `web`'s.

- **A board column now mounts 40 cards at a time instead of all of them**, revealing the next
  batch as the reader scrolls toward the end of the current one, and cards are marked
  `content-visibility: auto` so the mounted ones nobody is looking at cost no paint. Nothing
  about loading changed: every task page still drains into state, the column header still
  reports the column's true total, and the board still paints on the first page. What changed
  is how many of those rows exist as DOM at once — which is the number the cost of *dragging*
  scales with, because every mounted card is a dnd-kit sortable that re-runs on every pointer
  move. Measured on a seeded 1 000-task board (`SEED_LARGE_BOARD_TASKS=1000`, five columns,
  the largest holding 333), production build, drag driven at ~120 pointer moves per second for
  four seconds: the main thread went from **99.9% busy with 28 long tasks totalling 3.8 s** to
  **34.1% busy with none**, per processed pointer move from **84 ms to 2.6 ms**, DOM nodes from
  **18 421 to 3 854**, and heap after a drag from **117 MB to 19 MB**. Time to the board's first
  paint was already good and is unchanged (~130–165 ms, first page then stream). Dragging,
  keyboard reordering and drops all behave as before, including onto and out of columns whose
  tail is not mounted. `content-visibility` alone was measured too and is not a substitute: it
  halved the frame time and left the main thread saturated (audit finding FE-03,
  [#125](https://github.com/dravcore/kurul/issues/125)).
- CI gate job: `.github/workflows/ci.yml` now defines a single required status check, `ci-ok`,
  instead of relying on multiple job names in branch protection. The gate runs only when all
  upstream jobs (lint, test, build) have completed, and fails if any is not successful — even
  if skipped or cancelled via concurrency — preventing PRs from silently passing when a job is
  renamed or a workflow is cancelled. See [docs/testing.md](docs/testing.md#ci) and
  [#145](https://github.com/dravcore/kurul/issues/145).
- **BREAKING:** `docker-compose.yml` and `docker-compose.dev.yml` no longer bake a fixed
  `kurul`/`kurul` Postgres password (or a passwordless Redis by omission of any choice)
  into the compose files themselves — every container on the same Docker network could
  previously connect to the database with a password identical across every Kurul install,
  with no separate secret to guess. `POSTGRES_PASSWORD` is now a required `.env` value with no
  default, using the same fail-loud pattern as `BETTER_AUTH_SECRET`: `docker compose config`/
  `up` refuses to start until it is set. `POSTGRES_USER`/`POSTGRES_DB` keep the `kurul`
  default so an otherwise-unmodified `.env` still works once the password is filled in, and
  `REDIS_PASSWORD` is new and optional — leaving it unset keeps `redis` passwordless exactly
  as before, so this half is not a breaking change on its own. See
  [docs/development.md#database-and-cache-credentials](docs/development.md#database-and-cache-credentials).

  **Migration for existing installs:** add `POSTGRES_PASSWORD=<your-password>` to `.env`
  before the next `docker compose up` — without it, compose now fails before creating a single
  container. **Picking a value here does not, by itself, change anything about an already
  initialized database:** the official Postgres image applies `POSTGRES_PASSWORD` only during
  `initdb`, i.e. only the very first time the `postgres_data` volume is created, so an existing
  volume keeps the role's original password no matter what `.env` now says. Two ways to bring
  them back in sync:
  - Set `POSTGRES_PASSWORD` in `.env` to whatever the running role's password **already is**
    (`kurul`, if this is the first time upgrading past this change) — the value only needs
    to be present and correct, not different from today.
  - Or actually rotate the role's password to a new value, on the running instance, before
    updating `.env` to match:

    ```bash
    docker compose exec -T postgres psql -U kurul -d postgres \
      -c "ALTER USER kurul WITH PASSWORD 'the-new-password';"
    ```

    then set `POSTGRES_PASSWORD=the-new-password` in `.env` and restart the stack. Doing this
    out of order — restarting with a `.env` password that does not match the volume's actual
    role password — makes `migrate`/`api` fail to authenticate against a Postgres container
    that otherwise reports healthy.
- Docker Compose now survives crashes and host reboots: every long-running service carries
  `restart: unless-stopped` (in `docker-compose.dev.yml` too; the one-shot `migrate` job is
  deliberately excluded), `api` gains a healthcheck against `GET /health/ready` so "healthy"
  means DB and Redis actually answer, `web` gains a root-page healthcheck, and `web` now waits
  on `api` being *healthy* rather than merely started.
- Docs consistency pass: Node ≥24, i18n status, squash policy, archive links,
  project-skeleton archived, TR design status synced.
- Documentation map sharpened for post-MVP: `docs/README.md` is a five-minute reading guide;
  `ROADMAP.md` is status + Beyond MVP only; Phase 0–9 checklists moved to
  `docs/archive/roadmap-mvp-phases.md`; shipped phase design specs moved to
  `docs/archive/specs/` (CHANGELOG links updated).

### Removed

- Two never-used indexes: `Column_boardId_idx` and `Notification_userId_createdAt_idx`
  (audit finding DB-07). Both looked redundant on structural grounds — a strict prefix of an
  existing unique/composite index, or no matching application query — but the finding also
  called for verifying that against `pg_stat_user_indexes.idx_scan` on production-like volume
  before dropping anything, so all five originally flagged candidates were load-tested first.
  Three came back genuinely in use (`TaskAssignee_taskId_idx` and `TaskLabel_taskId_idx` back
  the task board's assignee/label loading and were kept because Postgres's planner
  consistently prefers the narrower index over the wider unique one for that lookup;
  `Activity_workspaceId_createdAt_idx` was kept because the dashboard's throughput query
  picked it over its three-column sibling often enough across repeated trials that "always
  subsumed" didn't hold) and are staying. Only the two with zero measured scans across three
  independent seeded trials were dropped. See
  `apps/api/prisma/migrations/20260814150000_drop_unused_indexes` for the full methodology.

### Fixed

- **Board columns never scrolled independently; the page did** ([#184](https://github.com/dravcore/kurul/issues/184)).
  The app shell was `min-h-screen` — a floor with no ceiling — so nothing under it was bounded,
  a column's `overflow-y-auto` had nothing to clip against, and a long column grew the
  *document* instead. Measured on a board seeded with 1 000 tasks, the document reached
  27 425px: the reader scrolled the whole page past a `sticky` column header that was stuck to
  a box it had already left. The shell is now exactly `100dvh` with `overflow: hidden`, and
  `<main>` carries the `min-h-0` that passes the bound down.

  Every link below the shell was already correct and already inert — the board is
  `h-full min-h-0`, the canvas `min-h-0 flex-1`, the column's card list `flex-1
  overflow-y-auto` — so one `min-h` was holding the entire chain open. Three behaviours the
  design has always specified start working as a result: per-column scrolling, the sticky
  column header, and drag autoscroll inside a column. `dvh` and not `vh` because on a phone
  `100vh` is the viewport with the browser chrome retracted, which would push the topbar under
  the address bar on first paint. The consequence to know when adding a page: the document no
  longer scrolls anywhere under `(app)`, so a new route declares its own
  `flex-1 overflow-y-auto` — as the dashboard, settings and notifications pages already did,
  having been written for a bounded shell that had not been built yet.

- **An oversized JSON body answered `500` and was filed in Sentry as a server fault.** Express's
  body parsers signal every rejection by throwing an
  [`http-errors`](https://github.com/jshttp/http-errors) instance — a plain `Error` subclass
  carrying `status: 413`, not a Nest `HttpException` — so it matched only the
  `AllExceptionsFilter` fallback for an unrecognised error, and every request that sent too much
  data became an "unexpected server failure" in the error envelope *and* an event on a
  self-hoster's error-tracking quota. It is now `413 Payload Too Large` in the same envelope,
  with wording this project chose rather than the library's, and it is not reported: a client
  sending too much data is the API working as designed, exactly like a `404` or a `403`. The
  branch is deliberately narrow — it requires the full shape `http-errors` uses to identify its
  own errors (a real `Error`, a boolean `expose`, and `status === statusCode`) and it stops at
  4xx, so a library that merely records an upstream's status code cannot have its failure
  relabelled as a client error and disappear from error tracking. A malformed JSON body was
  never part of this: Nest converts any `SyntaxError` to a `400` before a filter sees it, and it
  is now pinned by a test that says so.

- **The request body limit was Express's unconfigured default, not a decision.** Nothing in this
  repository set one, so the API's real ceiling was body-parser's built-in **100 kB** — a value
  nobody chose and no file recorded, discoverable only by sending a large body and watching what
  came back. The limit is now explicit and named: `REQUEST_BODY_MAX_BYTES`, default `1048576`
  (1 MiB), documented in `.env.example` and
  [api-conventions.md](docs/api-conventions.md#request-body-size), applied to the JSON *and* the
  form-encoded parser. 1 MiB is about two orders of magnitude above the largest body any endpoint
  legitimately receives today (no array bodies; the longest single field any DTO accepts is 2048
  characters), and it is a memory ceiling as much as a size one — the body is parsed into heap
  before anything validates it. It has nothing to do with `ATTACHMENT_MAX_BYTES`: an upload is
  `multipart/form-data`, which these parsers never see.

- **`REDIS_URL`'s database index was accepted and then quietly ignored.** Every ioredis and
  BullMQ connection in the API is built by one function, `parseRedisUrl`, and it returned only
  `{ host, port, password }` — the URL's path segment (`redis://redis:6379/3`) and any `?db=`
  went nowhere. An operator who points several apps at one Redis and separates them by index —
  which is what the index is for — got database 0 anyway, with no warning and no error, on top
  of whatever was already living there. Redis `SELECT` is per connection, so it could not be
  corrected from outside the process either. The index is now carried through to every consumer:
  auth rate-limit counters, both BullMQ queues (`due-soon`, `cleanup`) and the Socket.io
  adapter's pair of clients. An index that is not a plain non-negative integer, or a path and a
  `?db=` that disagree, now fails loudly at connection time instead of being coerced to 0 — a
  typo in the one setting that exists to keep two apps apart must not silently put them
  together. **The separation an index buys is a keyspace, not a channel:** Redis pub/sub is not
  scoped by database, so two instances on different indexes still share the Socket.io fan-out
  channel while their queues and counters no longer collide (measured, and now asserted in
  `apps/api/test/redis-database-index.e2e-spec.ts`, which connects on index 3 and asks the
  server — `CLIENT LIST`, plus observer clients on 3 and 0 — where each connection and key
  actually landed, rather than asserting what the parser returned).
  Closes [#190](https://github.com/dravcore/kurul/issues/190).
- **The uptime monitor the docs tell you to build was pointed at a URL that is not the API.**
  `docs/development.md` said to monitor `https://<your-host>/health/ready`, which predates the
  reverse proxy: behind `proxy` that path matches the catch-all rule, reaches the web app and
  answers `307` with a redirect to `/login`. Followed together with the same section's "expected
  status: 200", it produces a monitor that is red on a perfectly healthy instance — and the
  obvious way to quiet it, widening the accepted statuses, produces one that is green during an
  outage instead. Measured on a running stack: `/health/ready` → `307`, `/api/health/ready` →
  `200 {"status":"ok","checks":{"database":"up","redis":"up"}}`. The path is corrected, the
  reason it is easy to get wrong is written down next to it, and the push-model cron beside it —
  which probed `localhost:4000`, a port no Docker deployment publishes any more — now goes
  through `docker compose exec` instead. `docs/self-hosting.md` gained the monitoring step
  itself, as step 5 of the deployment rather than a footnote, including the deliberate outage
  drill (`docker compose stop postgres` → `503` naming `"database":"down"`, `start` → `200`,
  both verified) that turns an alerting setup from a hypothesis into a safeguard.
- `docs/self-hosting.md` now explains the failure every reader hits before the first release
  that publishes images. `docker compose pull` exits non-zero with `denied` for `api` and `web`
  — the workflow that pushes them runs on a release tag, and `v0.1.0` predates it — after
  succeeding for `postgres`, `redis` and `caddy`, so the three that worked scroll the two that
  did not off the screen. The same is true of the files step 2 downloads: they come from `main`,
  which carries only what the newest release carried, so a reader can end up with a
  `docker-compose.yml` that has no `proxy:` service and no `docker/Caddyfile` to fetch beside
  it — at which point none of the guide's HTTPS applies to what they just downloaded. Both are
  named in Troubleshooting, with the build-from-source path that works in the meantime.
- `docs/self-hosting.md` told operators to look for `migrate` in `docker compose ps` output and
  expect it to say "exited". A plain `ps` lists running containers only, so the one-shot
  `migrate` row it names is the one row that is never there. Corrected to `ps -a`, with the
  expected output printed in full so "healthy" is recognizable rather than guessed at —
  including why `backup` and `proxy` show no `(healthy)` marker (neither declares a
  healthcheck), which otherwise reads as two broken services.
- The dashboard no longer greets a first visit with "Your boards couldn't load." in
  development. The board list and the dashboard summary share one boards `GET` so a single
  screen does not ask twice, but the shared request was created with the abort signal of
  whichever component happened to ask first. React StrictMode runs effects
  mount→cleanup→mount, so that first component's cleanup aborted the request everyone was
  waiting on, and the remount plus its sibling — which had asked for nothing to be cancelled —
  read the cancellation as a failed load. The shared request is no longer bound to any one
  subscriber's lifetime; unmount safety already comes from each subscriber ignoring results it
  no longer wants.
- Signing in returns the visitor to the page that sent them there. `/login` and `/register`
  were ignoring the `?next=…` both the route guard and the invitation screen had been writing
  into their URLs, so an invitee who followed an invitation link landed on the dashboard and
  had to find the invitation email again. The destination is now honoured on both screens and
  carried across the link between them — but only when it is a same-origin path, so a crafted
  `?next=https://evil.com` cannot turn the sign-in form into a phishing hop.
- Switching workspaces twice in quick succession no longer risks landing on the wrong role.
  `onSwitch` used to write whichever `fetchOwnMembership` reply arrived last in wall time, not
  whichever switch was requested last, so a slow first response could overwrite the second
  workspace's role with the first workspace's — most visibly as a moment of ADMIN-only
  controls, and their `403` toasts, flashing inside a workspace where the user is only a
  VIEWER. Each call now stamps a generation counter before awaiting anything and only the
  call that still holds it when its reply lands is allowed to write `activeRole`, the same
  pattern `use-board-mutations.ts`'s `moveGenerationRef` uses to drop overtaken drag results.
- The sidebar's collapsed/expanded state survives a reload and no longer resets itself when
  the viewport crosses the 1280px breakpoint. Previously every `matchMedia` `change` event
  unconditionally reapplied the breakpoint's answer, silently reverting a click made while on
  the other side of it, and nothing was persisted, so every session started back at the
  breakpoint default regardless of what was chosen last time. The toggle now writes to
  `localStorage`, and the breakpoint listener defers to a stored preference instead of
  overwriting it.
- Two columns created or moved into the same gap on the same board at the same time can no
  longer land on the same `position`. `ColumnService.create` read its siblings outside any
  transaction and, when the gap did not need a rebalance, ran a single unguarded insert;
  `move` opened a transaction but never locked the board row inside it. Both now take the
  same `SELECT … FOR UPDATE` lock on the board row that `createDefaults` already took when
  seeding a new board's starting columns, and that the task create/move path already took on
  the column row — a concurrency contract the column path had simply never picked up. The
  observable symptom was never data loss (`(position, id)` keeps ordering deterministic even
  on a tie) — only two users seeing a different column order than either expected.
- The due-soon scan no longer gives up for a full 15-minute tick on a single failed run.
  `DueSoonWorker`'s scheduler asked BullMQ for the queue defaults — one attempt, no backoff —
  so a run that landed on a momentary Postgres or Redis blip simply waited for the next
  scheduled tick instead of retrying inside the same one. It now gets three attempts with an
  exponential backoff (30s, then 60s), so a transient blip is absorbed in under two minutes
  instead of up to fifteen. The `failed` handler used to log every failure at `error` whether
  or not BullMQ was about to retry it; a mid-retry failure is now `warn`-level noise, and only
  the final failure — every configured attempt spent, nothing left to retry it — logs at
  `error` and is reported through `captureServerError` (opt-in Sentry, `docs/development.md`),
  since `removeOnFail: 50` alone only helps someone who already knew to go looking. Closes
  audit finding BE-06 ([#148](https://github.com/dravcore/kurul/issues/148)).

### Security

- **Release images are signed, ship an SBOM, and are built by workflows whose every action is
  pinned to a commit.** Three parts of audit finding SEC-06
  ([#157](https://github.com/dravcore/kurul/issues/157)), all of them things a self-hoster
  can now check rather than take on trust. Every `uses:` across the five workflow files moved
  from a mutable major tag (`@v7`, `@v3`) to a full commit SHA with the release in a same-line
  comment — a major tag is a pointer its owner can move, so an action compromised upstream
  reached this repository's runners on the next push with no diff for anyone to review. Each
  published image is then signed with cosign, keylessly: no long-lived key exists to be
  leaked, and the certificate binds the signature to this repository's release workflow at the
  release's git ref, which is what makes `cosign verify` say something a stranger can rely on.
  An SBOM (SPDX 2.3 JSON, from syft) is generated per image **per architecture** — amd64 and
  arm64 do not contain the same packages, so one file for both would have been quietly wrong
  for every ARM operator — and attached to the GitHub Release as an asset. The verification
  commands, with this repository's exact identity and issuer, are in
  [docs/self-hosting.md](docs/self-hosting.md#verifying-what-you-pulled); an unchecked
  signature protects nobody.
- **`TAG=vX.Y.Z` now resolves to a published image.** Every place in this repository that tells
  an operator how to pin a release — both READMEs, both self-hosting guides, `docs/development.md`
  three times, and the comment beside `image:` in `docker-compose.yml` — says `TAG=vX.Y.Z`, but
  the release workflow published `0.2.0`, `0.2` and `latest` and never `v0.2.0`, because
  `docker/metadata-action`'s `{{version}}` strips the `v`. Following the documented instruction
  could only ever end in a failed `docker compose pull`. The workflow now publishes the
  `v`-prefixed tag as well. Found while writing the `cosign verify` command, which needs an
  image reference that exists.
- **An attachment's display name can no longer be made to render as a different name.** The
  Unicode bidi overrides (U+200E/U+200F, U+061C, U+202A–U+202E, U+2066–U+2069) and the C0/C1
  control characters are now stripped from a stored filename at write time, and again when that
  name is written into `Content-Disposition`. U+202E reverses the rendering of everything after
  it, so a file uploaded as `invoice<RLO>gnp.exe` was shown — in the task panel and in the
  browser's own save prompt — as `invoiceexe.png`. Measured surviving the whole path before the
  fix: the RFC 5987 `filename*` parameter percent-encodes the character and the browser decodes
  it again, so neither half of the header caught it, and the ASCII `filename=` half looked clean
  either way. The same cleaning now also applies to a `LINK`’s label, which went through none
  at all — it never reaches a header, but it reaches the same panel. Ordinary non-ASCII names are
  unaffected and a control test says so.
- **The byte-stream endpoint’s tenant guard is now covered by a test.** `@WorkspaceScoped()` on
  `GET /workspaces/:workspaceId/attachments/:id/content` could be deleted with the entire API
  suite — 1064 unit tests and 34 integration tests — still green: every tenant-scope test put the
  requester's *own* workspace id in the path, which exercises the service's `where` clause and
  not the guard. The uncovered case is the one that matters more: a signed-in non-member writing
  the *owning* workspace's id into the path is asking for a row that really does live there, so
  the `where` clause matches and only the guard stands in the way. Two integration tests now
  cover it — a user who belongs to no workspace, and a user who belongs to a different one.
- **A cross-origin upload is now proven not to buffer the body before it is rejected.** The
  origin allowlist covers `POST` and therefore covers uploads, and an existing test showed the
  handler never runs — but multer buffers the whole part before the handler either way, so that
  was one step short of the property the megabyte-sized limits depend on. A test with a
  disk-backed multer now measures the destination directory staying empty, with an allowed-origin
  control that shows the same request really does write a file there.
- **State-changing requests are now checked against an origin allowlist, server-side.** Until
  now every CSRF defence the API had lived in the browser: a `SameSite=Lax` session cookie and
  a single-origin CORS allowlist. Server-side there was nothing, and that was measurable — a
  `POST /workspaces` carrying a valid session cookie and `Origin: https://evil.example` was
  answered `201` with a created workspace, and so was the same request form-encoded, which is
  the case that matters most: `application/x-www-form-urlencoded` makes a cross-site POST a
  *simple request*, so no preflight is sent and CORS never gets to decide anything at all. For
  the single most CSRF-prone request shape there were zero layers, not one. `POST`, `PUT`,
  `PATCH` and `DELETE` are now refused with `403` when they announce an origin — in `Origin`,
  or in `Referer` when `Origin` is absent — outside the allowlist, which is derived from the
  same `WEB_URL` that configures CORS so the two can never drift apart. `Origin: null`, what a
  sandboxed document sends, is not on the list. A request announcing no origin at all still
  passes: browsers must send `Origin` on every non-`GET`/`HEAD` request, so no cross-site shape
  both carries a victim's cookie and omits it, and refusing the header-less case would break
  `curl`, CI, native clients and the web app's own server-side session lookup while closing
  nothing. Implemented as Express middleware rather than a Nest guard because `/auth/*` bypasses
  the Nest router (ADR 0004) and needed the check just as much — Better Auth's `originCheck`
  guards redirect targets, not credential endpoints, and cross-site `POST /auth/sign-in/email`
  and `POST /auth/sign-out` were both measured answering `200`. Better Auth's own check is left
  intact underneath. Reads are untouched and still governed by CORS. Serving the app and the API
  from one origin (`docker/Caddyfile`) keeps the cookie `SameSite=Lax` and remains the
  recommended deployment; this is the layer that survives the deployments that leave that path,
  where the cookie has to be `SameSite=None` and `SameSite` protects nothing. Operator
  consequence: `WEB_URL` must be the exact origin the browser loads the app from — any spelling
  of it (trailing slash, path, explicit `:443`) works, a non-URL now fails the process at start.
  See [api-conventions.md](docs/api-conventions.md#cross-origin-requests). Closes audit finding
  SEC-04.
- Rate limiting across the whole API surface. A global `ThrottlerGuard` gives every route
  100 requests per minute per client IP, with tighter budgets where a request is expensive
  or reaches outside the process: 10/min on invitation creation (each one hands a message to
  the SMTP relay, addressed by the caller) and 30/min on task search (`?q=` is a trigram
  scan — the same route without `q=` keeps the default, so ordinary board paging is
  untouched). `/health` and `/health/ready` are exempt, because a throttled probe reports a
  healthy API as down. Over-budget requests get `429` in the standard error envelope with a
  `Retry-After` header. `/auth/*` bypasses the Nest router (ADR 0004), so Better Auth's own
  limiter is now configured explicitly rather than left on its production-only default, and
  its counters go to Redis via `rateLimit.customStorage` when `REDIS_URL` is set — shared
  across instances and surviving restarts, without moving sessions out of Postgres the way
  `secondaryStorage` would. No Redis is still a supported configuration: the counters stay in
  memory and a warning says so. `RATE_LIMIT_ENABLED=false` turns both limiters off for the
  integration suite. See [api-conventions.md](docs/api-conventions.md#rate-limiting).
- Rate limiting now counts the real client behind a reverse proxy, instead of the proxy's own
  address for every request. A new `TRUST_PROXY` variable (off by default — safe for a
  directly-exposed instance) sets Express's `trust proxy`, which both the `ThrottlerGuard`'s
  default tracker and the access log's new `ip` field read from `req.ip`. Better Auth's own
  rate limiter turned out not to consult that setting at all — it re-parses
  `X-Forwarded-For` itself and, without further configuration, accepted a single-value header
  outright even with no proxy in front of the app, letting a directly-exposed instance's
  `/auth/*` sign-in limit be bypassed by rotating a fabricated header. It is now pointed at a
  private header the app stamps with the same Express-resolved address on every request,
  overwriting anything a client sent, so both routers key on one value computed once. See
  [api-conventions.md](docs/api-conventions.md#rate-limiting).
- The API now sends baseline security headers on every response via `helmet`
  (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, and friends). The CSP is API-shaped
  (`default-src 'none'`) because the service renders no HTML, and `Cross-Origin-Resource-Policy`
  is `cross-origin` so the web app on `WEB_URL` keeps its CORS-gated access.
- Every service in `docker-compose.yml` and `docker-compose.dev.yml` now runs with the full
  Linux capability set dropped (`cap_drop: [ALL]`) and `no-new-privileges:true` set — the
  capability half of SEC-02 that PR #109's `USER node` left open. `api`, `web`, `migrate`,
  and `backup` need nothing added back; `postgres` gets `CHOWN`/`FOWNER`/`SETUID`/`SETGID`/
  `DAC_OVERRIDE` back (its official entrypoint `chown`s `PGDATA` and re-execs via `gosu` on
  every boot); `redis` gets `SETUID`/`SETGID` back so its own entrypoint can drop privilege
  to the `redis` user via `setpriv` (see the next entry for why that path was broken before
  this PR). See [development.md#container-hardening](docs/development.md#container-hardening)
  for the full per-service reasoning.
- **Fixed:** the `redis` service ran as root for its entire life, not the `redis` user the
  image ships. `REDIS_PASSWORD` becoming optional (below) wrapped the container's command in
  `sh -c 'if [ -n "$REDIS_PASSWORD" ]; then …; fi'`, which handed the official image's
  entrypoint `sh` as its first argument instead of `redis-server` — exactly what the
  entrypoint's own privilege-drop check keys on, so the drop silently never ran. This was
  real on `develop` between that change and this one, not merely theoretical: `docker top`
  (not `docker exec ... id`, which reports the exec session's own user rather than PID 1's)
  showed `redis-server` owned by `root`. Fixed by switching `command:` to exec form —
  `['redis-server', '--requirepass', '${REDIS_PASSWORD:-}']`, substituted by Compose itself
  — so the entrypoint sees `redis-server` again and drops privilege as designed; verified
  with `docker top` showing uid 999 and a `SET`-then-restart cycle surviving intact in both
  the password and no-password cases.

## [0.1.0] - 2026-08-12

First release: roadmap Phases 1–9 — the MVP — together with the post-MVP hardening pass that
followed them. Everything below had been accumulating under `[Unreleased]` since the first
commit; this is the point it becomes a version.

### Added

- The notification bell subscribes to `notification:unread-changed` instead of relying on a
  poll. The event is a signal, not the notification: the badge only needs a number, so the
  client answers with one integer and refetches the list only when it is open. Polling stays
  as a fallback for what a socket cannot cover — its own absence — at 120s and paused while
  the tab is hidden.
- CodeQL analysis and a blocking `pnpm audit --audit-level high` step run on every pull
  request.
- Interface language is a stored user preference
  ([ADR 0018](docs/decisions/0018-localization-strategy.md)). `User.locale` holds a nullable
  IETF tag, a **Settings → Language** screen writes it and mirrors it into a `locale` cookie,
  and `apps/web/i18n/request.ts` resolves each render through
  `User.locale → locale cookie → Accept-Language → 'en'`. There is no `[locale]` path segment
  and no i18n middleware. `null` is a real state, distinct from `'en'`: it means "follow my
  browser", and the picker exposes it as **Match my browser**.

  English is still the only language on offer — this is the mechanism, not the translation.
  Adding a second one is a change to `SUPPORTED_LOCALES` plus the two places that then fail to
  compile (the API's seed-column names and the missing `messages/<tag>.json`); no migration and
  no backfill.
- `PATCH /me` writes the caller's own profile. Session-guarded and not role-gated, since the
  subject is the caller; `locale` is the only editable field today.
- `POST /workspaces/:workspaceId/boards/:boardId/columns/defaults` seeds an empty board's
  starting columns in one transaction and returns them. Replaces the three sequential POSTs the
  web made, which could fail halfway and leave a board holding two of the three stages with no
  way to tell that from a set the user had trimmed. Same roles as creating a single column;
  `409` when the board already has columns, so a double-click cannot produce two Done columns.
- New boards are seeded with columns named in the creator's language — resolved from
  `User.locale`, falling back to `Accept-Language`. `ColumnCategory` still travels with each
  seed column, so a translated Done column keeps counting as completed
  ([ADR 0019](docs/decisions/0019-column-category.md)).
- Column settings replace the rename-column dialog and set a column's name and category
  together. Without a way to say that "Shipped" means completed, the metrics fix above only
  applies to columns still called Done.
- Contributor License Agreement scaffolding for the dual-licensing model
  ([ADR 0014](docs/decisions/0014-dual-licensing-cla.md)): Harmony-derived CLA draft
  (`docs/cla.md`, EN/TR; deleted 2026-08-22 with `docs/archive/`) — **not in force, pending legal review** — plus a
  merge-blocking `CLA` workflow, a CONTRIBUTING section, and a PR-template checkbox.
- `GET /workspaces/:workspaceId/members/me` returns the caller's own membership, so the app
  shell resolves the active role from one indexed row instead of `/me` plus the full roster.
- Phase 9 realtime board sync
  (spec, `docs/archive/specs/2026-08-09-phase-9-realtime-design.md`): Socket.io gateway with Redis
  adapter, session-cookie auth, `board:{id}` rooms, thin ID event contract (`actorId`),
  emit-after-commit from task/column/comment mutations, web `useBoardSocket` with reconnect
  resync and mid-drag cancel. Presence remains out of MVP; notification unread push shipped separately, above.
- Deferred follow-ups: `/notifications` page (unread + type filters, cursor Load more,
  View all from the bell) and dashboard created-vs-completed throughput (14 UTC days;
  `task.moved` payloads include column names). See
  deferred notes, `docs/archive/specs/2026-08-09-phase-8-deferred.md` (archived; open items
  moved to [roadmap.md](ROADMAP.md#beyond-mvp)).
- Phase 8 activity log and notifications
  (spec, `docs/archive/specs/2026-08-09-phase-8-activity-notifications-design.md`): activity writes
  on task create/update/move/delete/assign/comment; workspace and task feeds; `Notification`
  model (assignment, mention, due-soon via BullMQ); shell bell + task History; comment
  `@[Name](userId)` mentions. Email deferred
  (notes, `docs/archive/specs/2026-08-09-phase-8-deferred.md`, archived).
- Phase 7 dashboard
  (spec, `docs/archive/specs/2026-08-09-phase-7-dashboard-design.md`):
  `GET .../dashboard/summary?boardId?` with total/overdue tiles, priority and assignee
  charts, optional per-board column chart (Recharts), empty/loading states; completion
  over time now on `throughput` (Activity-backed).
- Phase 6 filtering and search
  (spec, `docs/archive/specs/2026-08-09-phase-6-filtering-design.md`): whitelisted `TaskQueryDto`
  on `GET .../boards/:boardId/tasks` (`q`, priority, assignee, label, due-date null/range,
  sort), cursor pagination (`CursorPage<TaskDto>`), filter indexes, and a URL-synced board
  filter bar with chips, `/` search focus, and empty state.
- Phase 5 task metadata
  (spec, `docs/archive/specs/2026-08-09-phase-5-task-metadata-design.md`): board label CRUD with
  `LabelColorSlot` colors, task assignees/labels, priority/`dueDate`/`estimatedMinutes`
  on `PATCH` tasks, comments, [ADR 0011](docs/decisions/0011-label-task-metadata-permissions.md),
  enriched `TaskDto`/`CommentDto`/`WorkspaceMemberDto`, and panel/card UI for metadata.
- Phase 4 tasks and drag-and-drop
  (spec, `docs/archive/specs/2026-08-09-phase-4-tasks-design.md`): workspace-scoped task CRUD,
  fractional `Task.position` moves with on-demand rebalance,
  [ADR 0010](docs/decisions/0010-task-permissions.md) (MEMBER+ mutate), `@dnd-kit`
  multi-column board with optimistic move + toast rollback, and a title/description
  detail panel at `/board/[boardId]/task/[taskId]`.
- Visual debt closure and Phase 4 groundwork
  (spec, `docs/archive/specs/2026-08-09-visual-debt-design.md`): design.md type-scale tokens,
  reduced-motion policy that keeps color/opacity, shared `DamgaMark`, token-themed sonner
  toasts with retry actions, elevation tokens, shared 48px topbar, workspace switcher
  dropdown (usable from the collapsed rail), sliding sancak rail, shell loading skeleton,
  auth screens on the identity system (Fraunces display + damga + ui primitives), board
  column stagger on first paint, board card hover/focus states, and a11y fixes
  (`aria-current`, `menuitemradio` switcher, `main` landmark).
- Phase 3 boards and columns: workspace-scoped board/column CRUD, default columns on
  board create, Float fractional column reordering with on-demand rebalance helper,
  [ADR 0009](docs/decisions/0009-board-column-permissions.md) role matrix, design tokens
  (light/dark), Archivo/Fraunces/JetBrains typography, shadcn primitives, board list and
  board page shell with column dialogs.
- Phase 0 documentation and standards: governance files, process docs, architecture docs,
  ADRs 0001–0008, EN/TR mirrors, and repository branch protection / merge defaults.
- Phase 1 monorepo skeleton: pnpm workspace (`apps/api`, `apps/web`,
  `packages/shared-types`), NestJS + Prisma schema/migration/seed, Next.js + next-intl
  placeholder login, Docker Compose, and CI workflow.
- Phase 2 auth and workspaces: Better Auth (organization plugin) on Nest `/auth/*`,
  `GET /me`, session/workspace/role guards, workspace CRUD + invitations, web
  login/register/invite + workspace switcher, and auth/isolation/role-matrix tests.
- `@kurul/auth-access` — shared Better Auth organization access-control roles for api
  and web.
- Shared Prisma/`pg` pool for Nest and Better Auth; FK and list query indexes migration;
  workspace-nested scaffold routes (`/workspaces/:workspaceId/...`).
- Web: typed Nest API client, Next.js middleware session gate, layout split
  (`WorkspaceProvider` / `AppSidebar` / `AppShell`).
- CI `format:check` (Prettier) on every PR.

### Changed

- The interface speaks one vocabulary. A task is a task, never a card; an invitation is an
  invitation, never an invite; the copy and the message keys both say "confirm" for email
  confirmation rather than the keys saying "verify" while the copy said "confirm"; role names
  are lowercase in prose. Two pairs of identical strings living under different keys were
  collapsed — harmless while English is the only language, guaranteed to drift once it is not.
- Success messages are the exception rather than the default. `docs/design.md` §7 now states
  the rule — a message exists only where the screen cannot already answer "did that work?" —
  and only three flows meet it: column settings, where `category` has no on-screen
  representation; accepting an invitation, which lands on a dashboard that never mentions it;
  and deleting a board label, which strips it from every task while the screen shows one chip.
  Creating, deleting, moving, renaming and commenting confirm themselves.
- Every error ends with a way out, and §7 records how that is decided: if the identical request
  could succeed on a second attempt the surface carries a control, otherwise the sentence
  carries the next move. An explained failure never gets a retry button, because one that
  re-fails on every press teaches the user the product is broken — and a control still on
  screen and still live already is the retry.

- Kurul no longer accepts external code, documentation, or translation contributions
  ([ADR 0015](docs/decisions/0015-no-external-contributions.md)): the codebase stays
  single-authored, the CLA draft is kept but not enacted, and legal review is deferred to the
  first commercial sale. The `CLA` workflow is disabled (manual trigger only, plus an
  `if: false` job guard) rather than deleted, so no contributor is asked to sign a draft
  agreement for a pull request that would not be merged. CONTRIBUTING, the PR template, and
  `docs/cla.md` (EN/TR) now state the pause is indefinite.
- Docs: README and process docs reflect MVP complete (Phases 1–9); Turkish architecture
  module map aligned with English; api-conventions / testing / development status wording
  updated for shipped realtime.
- Docs: `docs/decisions/0011-label-task-metadata-permissions.md` superseded on the comment-delete
  rule by [ADR 0012](docs/decisions/0012-comment-delete-authorship.md) (author OR OWNER/ADMIN,
  not any MEMBER); `docs/archive/specs/2026-08-09-phase-8-deferred.md` archived to
  `docs/archive/specs/` with its remaining open follow-ups folded into
  [roadmap Beyond MVP](ROADMAP.md#beyond-mvp); api-conventions, tech-stack, testing, and
  architecture docs refreshed to match the shipped activity/dashboard/notification routes, ADRs
  0009–0012, web Vitest in CI, next-intl, and the develop merge-commit practice actually in use.
- Tooling: type-aware ESLint (floating-promise, React hooks rules), Husky pre-commit, Dependabot,
  and CI coverage; added comment/label guardrail unit specs.
- Tech-debt refactor (Wave 5): centralized UUID/pagination/optional-DTO validation helpers and
  workspace-role decorators across API controllers, enriched `CreateTaskDto` label/assignee
  handling, and fixed board a11y (drag-handle ARIA, localized DnD announcements, mention
  combobox keyboard support).
- Tech-debt refactor (Wave 6): shared request DTOs in `@kurul/shared-types`
  (`packages/shared-types/src/requests.ts`), split `board-view` and `task-metadata-panel` into
  focused modules/hooks, and added test coverage for `TaskService.remove`, `WorkspaceGuard`,
  notifications, and realtime edge cases.
- **Breaking:** `GET /workspaces/:workspaceId/boards/:boardId/tasks` now returns
  `CursorPage<TaskDto>` (`{ items, nextCursor, hasMore }`) instead of a bare `TaskDto[]`.
  Clients must drain pages (or raise `limit`, max 100) to load a full board.
- **Breaking:** `GET /workspaces/:workspaceId/members` now returns
  `CursorPage<WorkspaceMemberDto>` (`{ items, nextCursor, hasMore }`) instead of a bare
  `WorkspaceMemberDto[]` capped at 1000 rows, and accepts `?limit=` (default and max 100)
  and `?cursor=`. Clients drain pages — `fetchAllWorkspaceMembers` in
  `apps/web/lib/member-query.ts` — instead of trusting a single response to hold the whole
  roster.
- Nest `/workspaces` is the sole public API for organization/workspace mutations; Better
  Auth `/auth/organization/*` mutation paths are HTTP-firewalled (reads + `set-active`
  remain).
- Pagination docs: cursor `CursorPage<T>` is the shared typed default; no `OffsetPage`
  export.
- Product enums in `@kurul/shared-types` include `InvitationStatus` and
  `LabelColorSlot` (`slot-1`…`slot-8`); invitation DTO status is no longer a free string.
- ESLint docs aligned with the flat config actually shipped (no Nest/Next/import plugins
  yet).

### Removed

- Tech-debt cleanup: unused `ts-node` from `apps/api` (`@prisma/client` was later restored —
  Prisma 7 needs the package physically present for `prisma generate` even with a custom
  `output` path); dead
  `NotificationService.createDueSoon` (the due-soon worker batches inserts directly) and the
  `dashboard-throughput` helpers (`isDoneColumnName`, `isCompletedMove`, `applyThroughputCounts`)
  that only specs exercised; stale `.gitkeep` placeholders in directories that now hold real
  files; unused `--ease-in-out` / `--ease-drawer` CSS tokens.

### Fixed

- Failure messages name the thing that actually failed. **Add column** and **Add task** failed
  with "Could not *create* this column/task", breaking the verb halfway through the flow;
  posting or deleting a comment fell through to "Could not save this task."; deleting a board
  label reported itself as an update.

- Failed loads no longer report as empty successes. A failed notification load said "You're
  caught up" while unread items existed, a cold deep link to a task flashed "This task no
  longer exists", a failed metadata load read as "No comments yet", and a board list with no
  active workspace yet blamed a request that was never made. `useBoardData` also passed
  "task is missing" as the error message for *every* failure, so a network error claimed the
  task had been deleted; it now reads the status and only says that on a `404`.
- `app/(app)/error.tsx`, `app/error.tsx` and `not-found.tsx` keep a render error or a dead
  link inside the design system. A broken board now keeps the sidebar, switcher and bell
  rather than dropping the user onto an unstyled page.
- Label colours are named — blue, orange, aqua, yellow, magenta, green, violet, red, the
  vocabulary `docs/design.md` §8 already used — instead of rendering the storage slot ids
  `slot-1`…`slot-8` on screen.
- A 150-minute estimate renders as "2h 30m" rather than "150m", with the phrasing owned by
  the message catalogue so word order stays translatable.
- Renaming a board's Done column no longer zeroes its completion and throughput metrics
  ([ADR 0019](docs/decisions/0019-column-category.md)). Columns carry a `ColumnCategory`
  (`BACKLOG` / `UNSTARTED` / `STARTED` / `COMPLETED` / `CANCELED`) that the dashboard reads
  instead of matching the column's name against `'done'`, so "Shipped", "Released" or a
  column seeded in another language counts as finished work. Completion is a *set* of
  columns: a board may mark more than one column `COMPLETED`. Only `COMPLETED` is consumed
  today; the other four are vocabulary for later.

  > **Upgrade note — one-time, manual.** The migration backfills `COMPLETED` where
  > `lower(btrim(name)) = 'done'`, which is the same rule the retired matcher used. **A board
  > whose Done column had already been renamed reports zero completions until someone opens
  > column settings and sets its category.** The backfill cannot recover intent from an
  > arbitrary name — that is the whole reason the name stopped being the carrier — so there is
  > nothing to guess from and no way to detect the affected boards. Those dashboards were
  > already reporting zero before this release; the fix is available to them, it is just not
  > automatic. Set the category once per affected column and the last 14 days of moves start
  > counting immediately.
- Tech-debt correctness pass (Wave 2): reject `null` on non-nullable update DTOs, preserve
  column `taskCount` after rebalance, map Prisma errors, fix dashboard "Other" assignee
  buckets, opaque `board:join` denies, scoped task updates, and board-view retry/patch/ref bugs.
- Tech-debt performance and resource pass (Wave 3): enable Nest shutdown hooks and Better Auth
  session cookie cache, batch due-soon scans and rebalance SQL, paginate comments, and add
  `pg_trgm` search indexes.

[unreleased]: https://github.com/dravcore/kurul/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/dravcore/kurul/releases/tag/v0.3.0
[0.2.0]: https://github.com/dravcore/kurul/releases/tag/v0.2.0
[0.1.0]: https://github.com/dravcore/kurul/releases/tag/v0.1.0
