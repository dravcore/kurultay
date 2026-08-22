# Development

How to set up a Kurul development environment and work in it day to day.

> 🌐 English (canonical) | [Türkçe](tr/development.md)

## Contents

- [Status](#status)
- [Prerequisites](#prerequisites)
- [Clone and install](#clone-and-install)
- [Environment variables](#environment-variables)
- [Database and cache credentials](#database-and-cache-credentials)
- [Database connection pool](#database-connection-pool)
- [SMTP and Mailpit](#smtp-and-mailpit)
- [Run modes](#run-modes)
- [Container hardening](#container-hardening)
- [pnpm scripts](#pnpm-scripts)
- [Database workflow](#database-workflow)
- [Data retention](#data-retention)
- [Activation funnel and telemetry](#activation-funnel-and-telemetry)
- [Upgrading and backups](#upgrading-and-backups)
- [Rollback](#rollback)
- [Observability](#observability)
- [Day-to-day loop](#day-to-day-loop)
- [Troubleshooting](#troubleshooting)

## Status

The monorepo and MVP feature set (Phases 1–9; Phase 0 was docs/standards) **exist** in the repository. Commands on this
page are the day-to-day contract — if reality and this document diverge, one of the two is a
bug and gets fixed in the same PR.

- Layout and module map: [architecture.md](architecture.md#2-monorepo-layout)
- Data model and critical field rules: [architecture.md](architecture.md#critical-field-rules)
- Phase progress (MVP complete): [ROADMAP.md](../ROADMAP.md)
- Why each tool was chosen: [tech-stack.md](tech-stack.md)

## Prerequisites

| Tool           | Version            | Check                    | Notes                                                                                                                                                                                                        |
| -------------- | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js        | **≥ 24** (engines) | `node -v`                | Root `package.json` `"engines": { "node": ">=24" }`. Prisma 7 needs ≥ 20.19.0; the project floor is higher. **24 LTS** is the supported line.                                                                |
| pnpm           | 9 or newer         | `pnpm -v`                | Via Corepack: `corepack enable && corepack prepare pnpm@latest --activate`. Corepack is no longer bundled with Node ≥ 25 — there, `npm i -g corepack` first, or install pnpm standalone with `npm i -g pnpm` |
| Docker         | any current        | `docker -v`              | Docker Desktop or Colima on macOS                                                                                                                                                                            |
| Docker Compose | v2 (plugin)        | `docker compose version` | `docker-compose` v1 is not supported                                                                                                                                                                         |
| Git            | 2.30+              | `git --version`          |                                                                                                                                                                                                              |

No local PostgreSQL or Redis installation is needed — both run in Docker.

## Clone and install

```bash
git clone https://github.com/dravcore/kurul.git
cd kurul
cp .env.example .env   # fill it in — see Environment variables below
pnpm install           # installs every workspace package
pnpm bootstrap         # everything else on this page's setup path, in one command
```

The rest of this section explains what `pnpm bootstrap` does and why each step is there, because
the steps are the ones you will otherwise run individually while working — see
[Run modes](#run-modes) for the script itself.

The repository is a pnpm workspace (`apps/*`, `packages/*`). Always run `pnpm install` from
the repository root — never inside `apps/api` or `apps/web`.

The generated Prisma client (`apps/api/src/generated/`) is git-ignored and there is no
`postinstall` hook that creates it — `pnpm db:generate` is a required, explicit step on every
fresh clone. Code that imports `@prisma/client`-derived types will not typecheck or build
until you've run it at least once.

`packages/shared-types` and `packages/auth-access` are consumed from their built `dist/`,
which is git-ignored for the same reason, so a fresh clone needs them built before `pnpm dev`,
`pnpm db:seed`, `nest build` or `next build` will run:

```bash
pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build
```

Skipping this does not produce a helpful error. `pnpm dev` fails in `apps/api` with
`TS2307: Cannot find module '@kurul/shared-types'`, and `pnpm db:seed` dies with
`Cannot find module '.../@kurul/auth-access/dist/cjs/index.js'` before it ever reaches the
database, both of which read like a broken checkout rather than a missing build. `pnpm build`
and `pnpm typecheck` both do this for you as a side effect; `pnpm dev`, `pnpm db:seed` and
`pnpm lint` do not. CI builds them explicitly before the lint job, which is where
`pnpm typecheck` runs.

The test suites are the exception. Jest (`apps/api`, unit and integration) and Vitest
(`apps/web`, `packages/auth-access`) map both packages to their `src/index.ts`, so `pnpm test`
passes on a checkout with no `dist` at all and never runs against a stale one; the CI test job
deliberately skips the build for that reason. A stale build is the worse of the two failures,
because it resolves: an enum added since the last build reads back as `undefined` in every
consumer. `pnpm dev` and `pnpm db:seed` still go through `dist`, so rebuild after pulling a
change to either package.

## Environment variables

```bash
cp .env.example .env
```

Then fill in the blanks. `.env` is git-ignored and must never be committed.

| Variable                              | Example                                                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | `postgresql://kurul:<POSTGRES_PASSWORD>@localhost:5432/kurul` | Prisma connection string — password segment must match `POSTGRES_PASSWORD` below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `REDIS_URL`                           | `redis://localhost:6379`                                      | Socket.io Redis adapter, caching, BullMQ scheduled jobs (`due-soon` and `cleanup` queues). A database index is honoured — see [Database and cache credentials](#database-and-cache-credentials)                                                                                                                                                                                                                                                                                                                                                                                              |
| `BETTER_AUTH_SECRET`                  | _(generate)_                                                  | Session signing secret — required, no default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BETTER_AUTH_URL`                     | `http://localhost:4000`                                       | Public URL of the API (Better Auth is mounted at `/auth/*`). Dev loop only — `docker-compose.yml` derives it from `SITE_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `API_PORT`                            | `4000`                                                        | NestJS listen port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `WEB_URL`                             | `http://localhost:3000`                                       | CORS origin for the API. Dev loop only — `docker-compose.yml` derives it from `SITE_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SITE_URL`                            | `http://localhost`                                            | **Compose only.** The one public origin the whole stack answers on, scheme included; `https://…` turns on Caddy's automatic HTTPS. See [Self-hosting](self-hosting.md)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `INTERNAL_API_URL`                    | `http://api:4000`                                             | Absolute API address the **web server** uses for middleware and SSR (a same-origin `/api` has no origin to resolve against inside Node). Set by `docker-compose.yml`; read at container start, not baked                                                                                                                                                                                                                                                                                                                                                                                     |
| `API_DOCS_ENABLED`                    | _(follows `NODE_ENV`)_                                        | Publishes the interactive console at `/docs` and the OpenAPI document at `/openapi.json`. Unset it follows `NODE_ENV`: on in development, **off in production**. `/docs` is an unauthenticated HTML page with a request console that carries the reader's own session, so a production instance opts in rather than out. The same document is committed at `apps/api/openapi.json` — see [api-conventions.md](api-conventions.md#the-openapi-document)                                                                                                                                       |
| `RATE_LIMIT_ENABLED`                  | `true`                                                        | Master switch for [rate limiting](api-conventions.md#rate-limiting). On by default; only the integration suite turns it off                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TRUST_PROXY`                         | `false`                                                       | Reverse-proxy hop(s) to trust for the real client IP — `false` (default), a hop count (`1`), or an IP/CIDR list. See [rate limiting](api-conventions.md#rate-limiting) — **never `true` on a directly-exposed instance**                                                                                                                                                                                                                                                                                                                                                                     |
| `NEXT_PUBLIC_API_URL`                 | `http://localhost:4000`                                       | API URL compiled into the web bundle — **baked at build time**. Dev loop only; the Docker image bakes the same-origin path `/api` instead, which is why one image serves every domain                                                                                                                                                                                                                                                                                                                                                                                                        |
| `REQUEST_BODY_MAX_BYTES`              | `1048576`                                                     | Largest JSON or form-encoded body the API parses, in bytes (1 MiB). Over it the answer is `413`, and it is **not** reported to error tracking. It never sees a multipart upload — see [api-conventions.md](api-conventions.md#request-body-size)                                                                                                                                                                                                                                                                                                                                             |
| `STORAGE_PATH`                        | _(blank in the dev loop)_                                     | Directory that holds uploaded attachment files. **Blank means attachments are off**: `GET /config` reports `attachmentsEnabled: false` and the UI hides the upload control. Links work either way. `docker-compose.yml` sets it itself, inside the `attachment_data` volume                                                                                                                                                                                                                                                                                                                  |
| `ATTACHMENT_MAX_BYTES`                | `26214400`                                                    | Largest single attachment **file**, in bytes (25 MiB). A disk ceiling and a memory one — an upload is buffered so its type can be sniffed. It must stay under the reverse proxy's body limit; the ordering rule is in [self-hosting.md](self-hosting.md#bringing-your-own-reverse-proxy)                                                                                                                                                                                                                                                                                                     |
| `ATTACHMENT_WORKSPACE_QUOTA_BYTES`    | `2147483648`                                                  | Ceiling on the **summed** size of one workspace's stored files, in bytes. Unset or blank = this default (2 GiB); a written `0` lifts it; negative refuses to boot. Checked at upload against `SUM(size)` of the workspace's FILE attachments; links store no bytes and never count. The quota is **soft** — concurrent uploads can each overshoot by at most one file. Rejection is `413` with `error: "Attachment Quota Exceeded"` ([ADR 0027](decisions/0027-attachment-quotas.md), updated 2026-08-21)                                                                                    |
| `ATTACHMENT_INSTANCE_QUOTA_BYTES`     | `21474836480`                                                 | The same ceiling summed over **every** workspace on the instance; unset = 20 GiB, `0` = unlimited. Set it below your volume's real headroom: `STORAGE_PATH` in the shipped Compose stack shares its filesystem with Postgres. The API logs both effective quotas at boot, marking which came from the environment, and warns if this one is set below the workspace quota ([ADR 0027](decisions/0027-attachment-quotas.md))                                                                                                                                                                  |
| `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`  | `268435456`                                                   | Bytes one client IP may submit to the upload route per fixed minute (256 MiB, about ten max-size uploads), charged from each request's `Content-Length` before multer reads the body; a multipart request without one is charged `ATTACHMENT_MAX_BYTES`. `0` switches it off; negative refuses to boot. Honours `RATE_LIMIT_ENABLED` and `TRUST_PROXY`; counters live in Redis when `REDIS_URL` is set and fall back to process memory on Redis errors. Rejection is `429` with `error: "Upload Budget Exceeded"` and `Retry-After` ([api-conventions.md](api-conventions.md#rate-limiting)) |
| `TRELLO_IMPORT_MAX_BYTES`             | `20971520`                                                    | Largest Trello export the importer accepts, in bytes (20 MiB). A **heap** ceiling rather than a disk one — the parsed graph is several times the bytes that produced it. Separate from both limits above, and importing needs no `STORAGE_PATH` ([ADR 0025](decisions/0025-trello-import-mapping.md))                                                                                                                                                                                                                                                                                        |
| `SMTP_HOST`                           | `localhost` (dev, via Mailpit)                                | SMTP server host. Unset entirely and the mail module logs instead of sending — see [SMTP and Mailpit](#smtp-and-mailpit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SMTP_PORT`                           | `1025` (dev, via Mailpit) / `587` (typical production)        | SMTP server port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SMTP_USER`                           | _(blank for Mailpit)_                                         | SMTP auth username, if your server requires one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SMTP_PASSWORD`                       | _(blank for Mailpit)_                                         | SMTP auth password, if your server requires one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SMTP_SECURE`                         | `false`                                                       | `true` for implicit TLS (port 465), `false` for STARTTLS/plaintext (587/25, and Mailpit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MAIL_FROM`                           | `Kurul <noreply@example.com>`                                 | `From:` header on outgoing mail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CLEANUP_ENABLED`                     | `true`                                                        | Master switch for the nightly [data-retention sweep](#data-retention). Off means the instance stops enforcing its own retention policy                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `NOTIFICATION_RETENTION_DAYS`         | `90`                                                          | Days a notification is kept **after it was read**. Unread notifications are never deleted, at any age. `0` = keep forever                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ACTIVITY_RETENTION_DAYS`             | `365`                                                         | Days an activity row is kept after it was written. `0` = keep forever — set this if you have a statutory audit-trail duty                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `INVITATION_RETENTION_DAYS`           | `90`                                                          | Days a **finished** invitation is kept, measured from when it was created. Finished = answered (accepted/rejected/canceled) or expired; a pending, unexpired invitation is never deleted, at any age. `0` = keep forever                                                                                                                                                                                                                                                                                                                                                                     |
| `DATABASE_POOL_MAX`                   | `20`                                                          | Max simultaneous connections the shared `pg` pool opens to Postgres — see [Database connection pool](#database-connection-pool)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000`                                                       | How long a request waits for a pool connection before failing, once all `DATABASE_POOL_MAX` are busy — see [Database connection pool](#database-connection-pool)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000`                                                       | How long a single SQL statement may run before Postgres kills it — see [Database connection pool](#database-connection-pool)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SENTRY_DSN`                          | _(blank)_                                                     | API error tracking. **Blank = off, and off means the SDK is never loaded** — see [Observability](#observability)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SENTRY_ENVIRONMENT`                  | _(blank)_ / `production`                                      | Label on API events; blank falls back to `NODE_ENV`. Set it if staging and production run the same image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SENTRY_RELEASE`                      | _(blank)_ / `v0.2.0`                                          | Version label on API events; best set to the deployed tag. Blank sends none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN`              | _(blank)_                                                     | Web error tracking, same opt-in rule — **baked at build time**, so rebuild the web image after changing it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`      | _(blank)_ / `production`                                      | `SENTRY_ENVIRONMENT`'s web counterpart, also build-time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `NEXT_PUBLIC_SENTRY_RELEASE`          | _(blank)_ / `v0.2.0`                                          | `SENTRY_RELEASE`'s web counterpart, also build-time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SEED_LARGE_BOARD_TASKS`              | _(blank)_ / `1000`                                            | Read only by `pnpm db:seed`. Adds a synthetic board of this many tasks next to the demo one. Blank or `0` skips it — see [Seeding a large board](#seeding-a-large-board)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `INSTANCE_ADMIN_EMAILS`               | _(blank)_                                                     | Comma-separated addresses allowed to read the instance-wide [activation funnel](#activation-funnel-and-telemetry). **Blank means nobody**, including the account that owns every workspace. A listed address grants access only once that account's own email is verified                                                                                                                                                                                                                                                                                                                    |
| `TELEMETRY_ENABLED`                   | `false`                                                       | Outbound telemetry. **Off by default; nothing is sent while this is `false`** — see [Activation funnel and telemetry](#activation-funnel-and-telemetry)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `TELEMETRY_ENDPOINT`                  | _(blank)_                                                     | Where the opt-in ping is POSTed. **No default**; `TELEMETRY_ENABLED=true` with this blank logs an error and sends nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TELEMETRY_TIMEOUT_MS`                | `5000`                                                        | How long the single boot-time ping may take before it is abandoned. Failure is a warning line and nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are read only by `next build` when
uploading source maps, and only when they are set; they are absent from `.env.example`
because a build without them succeeds silently. See
[Observability](#observability).

`.env.example` also carries `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`REDIS_PASSWORD`, `BACKUP_INTERVAL`, and `BACKUP_KEEP`. All six are **compose-only** —
`docker-compose.yml` interpolates them into the `postgres`/`redis`/`migrate`/`api`/`backup`
services and no application code reads them directly, so they are absent from the table
above and need no wiring in `apps/api`. See
[Database and cache credentials](#database-and-cache-credentials) for the first four and
[Upgrading and backups](#upgrading-and-backups) for the backup pair.

Generate a secret with:

```bash
openssl rand -base64 32
```

**Adding a new environment variable is a three-step change**, and all three go in the same
PR: wire it through the env helpers in `apps/api/src/common/env.ts` (or the call site that
reads `process.env` — there is no separate Zod/typed env schema today), add it to
`.env.example` with a safe placeholder, and document it in the table above.

## Database and cache credentials

Neither `docker-compose.yml` nor `docker-compose.dev.yml` bakes a well-known
`kurul`/`kurul` password into the Postgres container any more — `POSTGRES_PASSWORD` is
a required `.env` value, and compose refuses to start until it is set:

```bash
$ docker compose config
error while interpolating services.migrate.environment.DATABASE_URL: required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in .env — see docs/development.md#database-and-cache-credentials
```

This is the same fail-loud pattern as `BETTER_AUTH_SECRET` above: a placeholder default would
mean every self-hosted instance that skips reading `.env.example` carefully starts up with a
password every other Kurul install also has, on a database exposed to whatever else shares
its Docker network.

**Generate `POSTGRES_PASSWORD` and `REDIS_PASSWORD` with `openssl rand -hex 32`, not the
`-base64 32` used for `BETTER_AUTH_SECRET` above.** The difference matters here in a way it
doesn't for `BETTER_AUTH_SECRET`: both of these values are embedded directly in a connection
URL (`DATABASE_URL`/`REDIS_URL`), and we don't percent-encode them, so any of `/ @ : # ? %`
landing in the value corrupts the URL — `/` is the sharpest case, since it ends the
authority section right where it appears:

```bash
$ node -e "new URL('postgresql://kurul:ab/cd@postgres:5432/kurul')"
TypeError: Invalid URL
    at new URL (node:internal/url:840:25)
  code: 'ERR_INVALID_URL'

$ openssl rand -hex 32
1b7c3785ecf7f7bd2ec4826214889d19ff17d518ce44126ab6f07393b39b98a   # 0-9a-f only, always URL-safe
```

`-base64 32`'s alphabet includes `/` and `+`; with 43 base64 characters per password, the
odds of at least one `/` or `+` landing in there are `1 - (63/64)^43 ≈ 51%` — roughly a coin
flip on whether a freshly generated password silently breaks its own connection string.
`openssl rand -hex 32` has no such character to avoid.

| Variable            | Default           | Purpose                                                                                                                 |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `kurul`           | Postgres role compose creates on first boot and every service connects as                                               |
| `POSTGRES_PASSWORD` | _none — required_ | Postgres role password. No default; `docker compose config`/`up` fails loudly if unset                                  |
| `POSTGRES_DB`       | `kurul`           | Database name compose creates on first boot                                                                             |
| `REDIS_PASSWORD`    | _(blank)_         | Optional `requirepass` for the `redis` service. Unset keeps Redis passwordless, exactly as before this variable existed |

These four feed the `DATABASE_URL`/`REDIS_URL` that `docker-compose.yml` assembles for its own
`migrate`/`api` services (`postgres:5432`/`redis:6379`, the in-network addresses) — a
**separate** knob from the host-side `DATABASE_URL`/`REDIS_URL` in your `.env` that `pnpm dev`
uses to reach `localhost:5432`/`localhost:6379` in the [dev loop](#run-modes). Compose does
not keep the two in sync: if you change `POSTGRES_PASSWORD` or `REDIS_PASSWORD`, update the
host-side `DATABASE_URL`/`REDIS_URL` to match, or `api`/`web` running on the host will fail to
authenticate against the containers `docker-compose.dev.yml` starts.

`REDIS_PASSWORD` deliberately has no `:?`-required guard like `POSTGRES_PASSWORD` does — Redis
here holds cache entries, sessions, rate-limit counters, and the notification queue, all
rebuildable, never board data (see ["Redis is not backed
up"](#upgrading-and-backups)) — so making it required would break every existing
`docker-compose.yml` on upgrade for comparatively little gain. Leave it blank to keep the
previous passwordless behavior; set it to add defense in depth against another container that
lands on the same Docker network.

**A `REDIS_URL` may name a database index, and it is honoured.** `redis://localhost:6379/3`
puts this instance's keys — auth rate-limit counters and both BullMQ queues — on index 3, which
is how several apps share one Redis without stepping on each other's keyspace. Until
[#190](https://github.com/dravcore/kurul/issues/190) the
index was parsed off and thrown away, so such a URL was accepted and then used database 0
anyway; if you set one before that fix and something in database 0 looked like it belonged to
another app, it probably did. Two limits are worth knowing. **Pub/sub is not scoped by
database:** Redis delivers a published message to every subscriber of that channel whatever
index each connection selected, so two Kurul instances on different indexes still share the
Socket.io fan-out channel — the index separates keyspaces, not channels. And an index that is
not a plain non-negative integer (`redis://host:6379/staging`), or a path and a `?db=` that
disagree (`redis://host:6379/3?db=4`), is refused at connection time rather than quietly read
as 0 — the whole point of the setting is keeping two apps apart, so a typo in it must not put
them together.

**Changing `POSTGRES_PASSWORD` on an existing `postgres_data` volume does not rotate the
running database's password.** The official Postgres image only applies
`POSTGRES_PASSWORD` during `initdb`, i.e. the first time a volume is created — editing `.env`
and restarting an already-initialized stack leaves the role's password exactly as it was. See
the `[Unreleased]` entry in `CHANGELOG.md` for the `ALTER USER ... PASSWORD` command that
rotates it on a running instance.

### If your checkout predates the rename

The Postgres role and database are `kurul`; before v0.2.0 they were `kurultay`. A working tree
that already has a `.env` and a running dev stack keeps the old ones, and nothing tells you so
until something fails — so it is worth doing deliberately in one go:

```bash
# 1. Point .env at the new identifiers (DATABASE_URL, POSTGRES_USER, POSTGRES_DB).
# 2. Create the role and both databases in the volume you already have:
docker compose -f docker-compose.dev.yml exec -T postgres psql -U kurultay -d kurultay \
  -c "CREATE ROLE kurul LOGIN SUPERUSER PASSWORD 'kurul';" \
  -c 'CREATE DATABASE kurul OWNER kurul;' \
  -c 'CREATE DATABASE kurul_test OWNER kurul;'

# 3. Migrate both. The test database is a separate database and needs its own run:
pnpm db:migrate
DATABASE_URL=postgresql://kurul:kurul@localhost:5432/kurul_test pnpm db:migrate
```

Two failures are worth recognising rather than debugging. `The table public.UsagePing does not
exist` from the integration suite means step 3 was run against the dev database only. And
`DATABASE_URL does not name a test database` is not a rename problem at all — it is
`setup-e2e.ts` refusing to truncate a database whose name does not contain `kurul_test`, which
is the guard working. Point `DATABASE_URL` at the test database for that command, or unset it.

Dropping the old `kurultay` role and databases is optional and can wait until you are sure
nothing local still points at them.

## Database connection pool

`apps/api/src/prisma/database.ts` opens one process-wide `pg` `Pool` and shares it between
`PrismaService` and Better Auth (`apps/api/src/auth/auth.ts`) — see the module for why they
have to share rather than each opening their own. Three environment variables shape it, all
optional with defaults chosen to be generous enough that ordinary traffic never trips them:

| Variable                              | Default | Purpose                                                                         |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `DATABASE_POOL_MAX`                   | `20`    | Max simultaneous connections this instance opens to Postgres                    |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000` | How long a request waits for a connection once all `DATABASE_POOL_MAX` are busy |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000` | How long a single SQL statement may run before Postgres kills it                |

Before `DATABASE_POOL_CONNECTION_TIMEOUT_MS` existed, a request that arrived once the pool was
already at `DATABASE_POOL_MAX` connections queued with no ceiling — `pg`'s own default there is
`0`, i.e. wait forever. Under sustained load that turned pool saturation into requests that
never resolved instead of a clear, logged error. `DATABASE_STATEMENT_TIMEOUT_MS` closes the
matching gap on the query side: without it, one runaway statement (a missing index hit by a
large scan, a pathological filter) holds a connection — and one of the `DATABASE_POOL_MAX`
slots — indefinitely.

`DATABASE_STATEMENT_TIMEOUT_MS` is applied **per connection this pool opens**, as a Postgres
startup parameter (`pg`'s own handshake, not a query this codebase issues), so it reaches only
traffic that goes through `getSharedPool()`:

- `prisma migrate deploy` / `prisma migrate dev` are unaffected — migrations run through
  Prisma's own engine process against `DATABASE_URL` directly, never through this pool.
- `pnpm db:seed` (`apps/api/prisma/seed.ts`) is unaffected for its own bulk deletes and
  inserts — it opens a separate `Pool` for those. The one part of seeding that _does_ cross
  the shared pool is the Better Auth calls it makes (`signUpEmail`, `createOrganization`),
  which are ordinary lightweight queries nowhere near the 30s default.

Raise `DATABASE_POOL_MAX` alongside Postgres's own `max_connections` if an instance is
consistently queuing under normal load rather than only during spikes; an unbounded pool does
not fix that, it just moves the exhaustion from this app to whatever else shares the database.

## SMTP and Mailpit

Kurul sends email for two things: the verification link an invitee needs before
`accept-invitation` will let them join a workspace (see
[`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)),
and notification email (assignment, mention, due-soon), which each user can switch off under
Settings. Leaving `SMTP_HOST` unset is a valid choice — the API still boots, and the mail
module logs the message instead of sending it — but while that's true, **no invitation can be
accepted** and no notification email goes out.

That state is visible in the product, not only here. `GET /config` reports
`{ "mailEnabled": false }`, and the web app turns that into a standing notice on **Settings →
Members** saying that invitations will not be delivered, with a link back to this section.
`POST /workspaces/:workspaceId/invitations` also reports `"emailDelivery": "NOT_CONFIGURED"`
on the invitation it just created, so the admin is told at the moment they send it rather than
by a teammate who never got an email. Both are derived from the transport the mail module
actually selected — see
[api-conventions.md](api-conventions.md#instance-configuration). The way through without SMTP
is the **Copy link** control on each pending invitation: the accept link works, as long as the
invitee's address is already confirmed.

To exercise the real flow locally without sending real mail, use the `mailpit` service that
`docker-compose.dev.yml` already starts alongside `postgres` and `redis`:

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + mailpit
```

Then set these in your `.env` (already the defaults suggested by `.env.example`, but Mailpit
needs the host/port explicitly pointed at it):

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
# SMTP_USER / SMTP_PASSWORD stay blank — Mailpit does not require auth
MAIL_FROM=Kurul <noreply@example.com>
```

| URL                   | What                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| http://localhost:8025 | Mailpit web UI — every message the API sends lands here, never a real inbox |
| localhost:1025        | Mailpit's SMTP listener — what `SMTP_HOST`/`SMTP_PORT` above point at       |

To test the invitation flow end to end: send an invitation from the app, open
http://localhost:8025, click into the newest message, and open the verification link it
contains in your browser (or copy it — Mailpit renders the plain-text and HTML parts, and
the link works the same either way). The invitee's account is now verified and
`accept-invitation` succeeds. `docker compose -f docker-compose.dev.yml down -v` clears
Mailpit's stored messages along with the Postgres/Redis volumes — the dev loop's own
`kurul-dev_*` volumes only, never the full stack's; see [Full stack in
Docker](#full-stack-in-docker) below.

## Run modes

### Recommended: dev loop (services in Docker, apps on host)

Postgres and Redis run in containers; `api` and `web` run on the host with hot reload. This
is the fast loop — no image rebuild between code changes.

```bash
pnpm bootstrap   # shared packages, Prisma client, containers, migrations, demo data
pnpm dev         # api + web in parallel, hot reload
```

`pnpm bootstrap` ([`scripts/bootstrap.mjs`](../scripts/bootstrap.mjs)) runs exactly the
commands below, in this order, and adds a preflight on `.env` plus a wait on the containers'
own healthchecks — a `prisma migrate` fired at a Postgres that has accepted the TCP connection
but not finished `initdb` is the failure that wait exists to prevent, and it is the one a first
run hits. Run them by hand instead whenever you want only one of them:

```bash
pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build
pnpm db:generate                                 # generate the Prisma client
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + mailpit
pnpm db:migrate                                  # apply migrations
pnpm db:seed                                     # demo workspace, board, columns, tasks
```

The script is idempotent and is meant to be re-run after a `git pull`, which is why it does not
simply run `pnpm db:seed`: seeding **deletes before it inserts**, so it happens only when the
database holds no `Workspace` row yet. `--seed` forces it anyway, `--no-seed` skips it. If it
cannot read that table for any reason it also skips — the destructive branch is never the one
taken on a guess.

Run `pnpm db:drift` against a database that is already on the latest migration to confirm
`schema.prisma` and the committed migrations still agree — see [Checking for migration
drift](#checking-for-migration-drift) below.

| URL                          | What                           |
| ---------------------------- | ------------------------------ |
| http://localhost:3000        | Web app (Next.js)              |
| http://localhost:4000        | API (NestJS)                   |
| http://localhost:4000/health | Health check — must return 200 |

Stop the containers with `docker compose -f docker-compose.dev.yml down` (add `-v` to also
drop the dev loop's own `postgres_data`/`redis_data` and start from a clean slate).

### Full stack in Docker

Everything containerized, closest to production. Use it to verify the Dockerfiles and
compose wiring, or when you just want to run Kurul rather than develop it.

```bash
docker compose pull && docker compose up -d
```

This runs as its own Compose project — the checkout's directory name, usually `kurul`, since
`docker-compose.yml` declares no `name:` of its own — fully separate from the dev loop's
`kurul-dev` project above (`docker-compose.dev.yml` declares `name: kurul-dev`). Every
container and volume is namespaced by its project, so the two never collide: bringing the full
stack up does not recreate or touch the dev loop's `postgres`/`redis`/`mailpit`, and
`docker compose -f docker-compose.dev.yml down -v` does not touch the full stack's volumes
either, even if you run both on the same machine at once. (OPS-04, 2026-08-18 audit — before
this split, both files fell back to the same directory-derived project name, so they shared
container and volume names and could recreate or drop each other's data.)

Then open **http://localhost** — not `localhost:3000`. A `proxy` service (Caddy) is the stack's
only published entrance: it serves the web app and the API from one origin, routing `/api/*`
and `/auth/*` to `api` and everything else to `web`. `api` and `web` publish no host ports of
their own. Point the whole thing at a domain by setting `SITE_URL=https://kurul.example.com`
in `.env`, which also switches automatic HTTPS on — the walkthrough for that, SMTP and backups
included, is [Self-hosting](self-hosting.md).

`api`, `web` and `migrate` in `docker-compose.yml` all declare both `image:` and `build:`.
Every tagged release publishes all three to GHCR (`.github/workflows/release-images.yml`,
`linux/amd64` + `linux/arm64`), so `pull` fetches a ready-built image and the following `up -d`
starts it — no local build, no `pnpm install`, no Docker layer cache warm-up. Set `TAG` in
`.env` to pin a specific release instead of the default `latest`:

```bash
TAG=v0.2.0   # matches a tag published by release-images.yml; see `git tag -l` for the list
```

Compose's default pull policy only builds a service when its `image:` tag cannot be resolved
locally or from the registry, so nothing below breaks if you skip the `pull`: `docker compose
up -d` alone still tries the registry first and falls back to `build:` automatically — the
exact same source build this repo has always done — when there's no image for your `TAG` yet
(pre-release, or a `TAG` you've never had published) or no route to `ghcr.io`. `docker compose
up --build` (or `up -d --build`) keeps working unchanged for building on purpose, e.g. after
editing a Dockerfile or testing an unreleased change to `api`/`web`.

`migrate` used to be the one exception: it had no `image:` pair, so it always built from
source — a scoping [audit finding OPS-04](https://github.com/dravcore/kurul/issues/126) chose
deliberately, and one that turned out to break the curl-based install in
[docs/self-hosting.md](self-hosting.md), which downloads no source tree to build from (audit
finding OPS-01). It now carries the same `image:` + `build:` pair as `api`/`web`, with
`ghcr.io/dravcore/kurul-migrate` published from the first release after v0.2.0 onward — on
`TAG=v0.2.0` or older there is no such image to pull and the service builds from source
exactly as before.

### What the two API images weigh

Measured on `linux/arm64`. Docker answers "how big" three ways and they are far apart, so all
three are here — `docker history` summed, `docker image ls --tree`'s DISK USAGE (unpacked bytes
on the host) and its CONTENT SIZE (compressed, roughly what a `pull` moves):

| Image            | `docker history` | Unpacked disk    | Compressed   |
| ---------------- | ---------------- | ---------------- | ------------ |
| `api` (`runner`) | 955 → 407 MB     | 1.22 GB → 516 MB | 266 → 108 MB |
| `migrate`        | 2663 → 418 MB    | 3.37 GB → 538 MB | 705 → 120 MB |

Neither shrank by changing what the application depends on. The `runner` image shed the
optional peer dependencies `pnpm deploy --prod` leaves in a deploy directory — Next.js's SWC
binaries, the Prisma CLI and Studio, sharp, Playwright, the TypeScript compiler, none of them
reachable from `dist/main.js` — which `scripts/prune-deployed-modules.mjs` now removes; read
its header for how "reachable" is defined, and for the one class of breakage a manifest-only
walk cannot see — a package that requires something it never declared, which used to resolve
through pnpm's flat hoist. There is no static check for that; there is a boot with `SENTRY_DSN`,
`SMTP_HOST` and `REDIS_URL` set, which is what exercises the code no default-configuration
start-up touches. The
`migrate` image stopped being the entire build stage (workspace, every dev dependency, pnpm
itself) and became a clean base with the Prisma CLI, the schema and the migrations. Reproduce
any of these with `docker build -f apps/api/Dockerfile --target runner .` followed by
`docker history` and `docker image ls --tree` on the result.

What is left is mostly not ours: `node:24-alpine` is 171 MB of every one of these images
(Alpine 9.31 MB, Node 156 MB, Yarn 5.48 MB), 42% of the API image. Cutting that means a
different base, and the base is load-bearing — `docker-compose.yml`'s healthcheck is a busybox
`wget` run inside the container, which a distroless image would not have.

Next.js inlines `NEXT_PUBLIC_*` into the client bundle at build time, so a published image
cannot pick those up at container start the way `api`'s `DATABASE_URL` can. That is a property
of the framework and has not changed — what changed is that the value being baked is no longer
deployment-specific. The image carries `NEXT_PUBLIC_API_URL=/api`, a path on whatever origin
served the page, which is correct behind `proxy` on every hostname; **the same image runs on
any domain with no rebuild**. See [Why there is no rebuild](self-hosting.md#why-there-is-no-rebuild)
for the full reasoning, and `apps/web/lib/api-url.ts` for the code.

The Sentry DSNs are still genuinely build-time: turning browser error tracking on or off means
rebuilding `web` (`docker compose build web`, which reads `NEXT_PUBLIC_SENTRY_*` from your
`.env`), not just restarting it. `NEXT_PUBLIC_API_URL` is deliberately _not_ among that
`args:` block, so a local build produces the same bundle the release image does rather than
quietly baking whatever the dev loop left in `.env`. A deployment that really does want the API
on its own hostname overrides the build arg directly and accepts a domain-specific image:

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

This also starts the `backup` sidecar, which dumps the database on a schedule — see
[Upgrading and backups](#upgrading-and-backups). `docker-compose.dev.yml` has no such
service: the dev loop's database is throwaway by design.

|                             | Dev loop             | Full Docker                                       |
| --------------------------- | -------------------- | ------------------------------------------------- |
| Hot reload                  | Yes                  | No — rebuild required                             |
| Startup after a code change | seconds              | tens of seconds                                   |
| Matches production          | Partially            | Yes                                               |
| Use for                     | Everyday development | Verifying images, release checks, running the app |

## Container hardening

Every service in both compose files runs with the full Linux capability set dropped
(`cap_drop: [ALL]`) and `no-new-privileges:true` set, via the `x-hardened` YAML anchor at
the top of each file. A default container capability set — `CAP_NET_RAW`, `CAP_SYS_PTRACE`,
`CAP_CHOWN`, and a dozen others — is attack surface regardless of which OS user the process
runs as: a code-execution bug inherits whatever the kernel handed the container, not
whatever the application dropped on its own initiative. This is the second half of the
2026-08-13 audit's SEC-02 finding, since folded into [ROADMAP.md](../ROADMAP.md#hardening-track);
the first half — `USER node` in both Dockerfiles' runner stages, so `api`/`web` don't run as
root in the first place — landed in PR #109.

A capability is re-added only where a service was actually run with just the drop and
observed to fail, never because it "seems like it might need it." The comments beside each
`cap_add:` in the compose files carry the failure that justified it; the short version:

| Service      | `cap_add`                                             | Why                                                                                                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api`, `web` | none                                                  | Already `USER node` — no `chown`, `setuid`, or privileged port bind at any point in the container's life                                                                                                                                                                                                                       |
| `migrate`    | none                                                  | `USER node` as well, since the image shrink gave the stage its own base instead of reusing the root-owned `build` stage. It only opens a DB connection and reads the schema and migrations copied in beside it                                                                                                                 |
| `backup`     | none                                                  | `entrypoint:` replaces the postgres image's own entrypoint outright, so its chown/re-exec logic never runs — the sidecar stays root but never touches ownership of anything                                                                                                                                                    |
| `postgres`   | `CHOWN`, `FOWNER`, `SETUID`, `SETGID`, `DAC_OVERRIDE` | The official entrypoint always starts as root, `chown`s `PGDATA` to the `postgres` user on _every_ boot (not just the first), then `gosu postgres` re-execs itself — `DAC_OVERRIDE` specifically is needed from the second boot onward, once `PGDATA` is `chmod 0700` and root can no longer `find` its way in without it      |
| `redis`      | `SETUID`, `SETGID`                                    | The entrypoint drops privilege to uid 999 via `setpriv`, but only when its first argument is literally `redis-server` — see below                                                                                                                                                                                              |
| `proxy`      | `NET_BIND_SERVICE`                                    | Caddy binds ports 80 and 443 inside the container. With the capability dropped it does not fail at bind time but at exec (`exec /usr/bin/caddy: operation not permitted`): the image ships the binary with `cap_net_bind_service=+ep` file capabilities, and the kernel refuses to exec such a binary outside the bounding set |

**redis's `command:` is exec form, not a shell wrapper, and that isn't cosmetic.** An
earlier draft of this hardening pass used `command: ['sh', '-c', 'if [ -n "$REDIS_PASSWORD" ]; then …; fi']`
to keep `REDIS_PASSWORD` optional. That handed the container's entrypoint `sh` as its first
argument instead of `redis-server`, which is exactly what the entrypoint's own privilege-drop
check keys on — so the drop silently never ran, and redis-server spent its entire life as
root. Caught during review by checking `docker top` (not `docker exec ... id`, which reports
the _exec session's_ user from the image's `USER` directive, not PID 1's actual runtime
user — the wrong tool would have shown the same output either way and hidden the bug). This
was a genuine regression from PR #166, which introduced the `sh -c` wrapper to make
`REDIS_PASSWORD` optional without a hardcoded default.

The fix is `command: ['redis-server', '--requirepass', '${REDIS_PASSWORD:-}']` — array form,
substituted by Compose itself at config time (`${REDIS_PASSWORD:-}`, not the `$$` escape
used elsewhere in this file for values a container's own shell resolves at runtime). With
`redis-server` back as the literal first argument, the entrypoint's detection matches again,
`setpriv --reuid redis --regid redis` runs, and the capabilities that operation needs
(`SETUID`, `SETGID`) replace the `DAC_OVERRIDE` an earlier version of this document
described — `DAC_OVERRIDE` was compensating for running as root; once the process is uid 999
and owns `/data` outright (the image bakes it that way), no override is needed. Confirmed
with `docker top` showing `999 ... redis-server` instead of `root ... redis-server`, and a
`SET` → restart cycle that survives with the value intact in both the password and
no-password cases.

Out of scope for this hardening pass: a read-only root filesystem (`read_only: true`) and
seccomp profiles. Both are stricter constraints that need a per-service audit of which
paths must stay writable (temp dirs, node's own `/tmp` use, etc.); tracked as a follow-up
in [ROADMAP.md](../ROADMAP.md#hardening-track), not bundled in here.

## pnpm scripts

Run from the repository root.

| Script           | Command               | What it does                                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap`      | `pnpm bootstrap`      | Fresh clone (or fresh pull) → running dev loop: shared packages, Prisma client, containers, migrations, demo data. Idempotent; will not reseed a database that already holds workspaces. `--seed` / `--no-seed` override that. **Not** `pnpm setup` — that is a built-in pnpm command that writes to your shell profile |
| `dev`            | `pnpm dev`            | Runs `apps/api` and `apps/web` in parallel with hot reload                                                                                                                                                                                                                                                              |
| `build`          | `pnpm build`          | Builds every workspace package                                                                                                                                                                                                                                                                                          |
| `lint`           | `pnpm lint`           | ESLint across all packages                                                                                                                                                                                                                                                                                              |
| `format`         | `pnpm format`         | Prettier write across the repo                                                                                                                                                                                                                                                                                          |
| `format:check`   | `pnpm format:check`   | Prettier check (CI gate)                                                                                                                                                                                                                                                                                                |
| `typecheck`      | `pnpm typecheck`      | Builds `@kurul/shared-types` + `@kurul/auth-access`, then `tsc --noEmit` in every workspace                                                                                                                                                                                                                             |
| `test`           | `pnpm test`           | Runs the test suites of every workspace package                                                                                                                                                                                                                                                                         |
| `db:generate`    | `pnpm db:generate`    | Runs `prisma generate`: (re)builds the Prisma client from the schema. Does not touch migrations or the database. Required after cloning and after pulling schema/migration changes someone else made                                                                                                                    |
| `db:migrate`     | `pnpm db:migrate`     | Runs `prisma migrate deploy`: applies existing, already-committed migrations. Never creates a migration and never regenerates the client — safe for CI/production. If you only ran this after pulling new migrations, follow it with `pnpm db:generate`                                                                 |
| `db:migrate:dev` | `pnpm db:migrate:dev` | Runs `prisma migrate dev`: diffs your local schema, **creates a new migration file**, applies it, and regenerates the client. This is the command you run locally after editing `schema.prisma` — `db:migrate` alone will not create it                                                                                 |
| `db:seed`        | `pnpm db:seed`        | Loads demo data: one workspace, one board, default columns, a handful of tasks. Under Prisma 7 the seed entry point is declared in `prisma.config.ts` — seeding is never automatic and must be invoked explicitly                                                                                                       |
| `db:studio`      | `pnpm db:studio`      | Opens Prisma Studio at http://localhost:5555                                                                                                                                                                                                                                                                            |
| `db:drift`       | `pnpm db:drift`       | Runs `prisma migrate diff --from-config-datasource --to-schema apps/api/prisma/schema.prisma --exit-code`: compares the configured database against `schema.prisma` and exits non-zero on any difference. Same command CI runs after `db:migrate` — see [Checking for migration drift](#checking-for-migration-drift)   |

To target a single workspace, use pnpm's filter flag:

```bash
pnpm --filter @kurul/api dev
pnpm --filter @kurul/web build
pnpm --filter @kurul/api test
```

## Database workflow

```bash
# 1. Edit apps/api/prisma/schema.prisma
# 2. Create and apply a migration, and regenerate the client
pnpm db:migrate:dev
# 3. Load demo data (empty boards are hard to develop against)
pnpm db:seed
# 4. Inspect the data
pnpm db:studio
```

Use `pnpm db:migrate:dev`, not `pnpm db:migrate`, to create the migration — `db:migrate` only
applies migrations that already exist (`prisma migrate deploy`) and will not generate one from
your schema edit. `db:migrate:dev` also regenerates the Prisma client, so no separate
`pnpm db:generate` step is needed here.

When you're instead picking up migrations someone else already committed (e.g. after
`git pull`), use `pnpm db:migrate` followed by `pnpm db:generate` — `db:migrate` applies them
but, unlike `db:migrate:dev`, does not regenerate the client.

Rules:

- Migrations are **committed**. Never edit an already-committed migration file — write a
  new one.
- Schema changes go in their own PR, separate from the logic that uses them, whenever that
  split is practical.
- `Task.position` and `Column.position` are `Float` (fractional indexing) — see
  [architecture.md](architecture.md#critical-field-rules) for the model-level rules that must
  not be changed casually.

### Checking for migration drift

A schema edit that never got a matching migration is silent by nature: nothing breaks locally,
and the mismatch only surfaces as unrelated statements the next `prisma migrate dev` wants to
emit. `pnpm db:drift` catches it directly instead of waiting for that:

```bash
pnpm db:migrate   # bring the database to the latest committed migration first
pnpm db:drift     # compare it against schema.prisma
```

It runs `prisma migrate diff --from-config-datasource --to-schema apps/api/prisma/schema.prisma
--exit-code`, prints "No difference detected." and exits 0 when they agree, and otherwise
prints the mismatch and exits non-zero. There is no separate shadow database: `--from-config-datasource`
diffs the datasource in `prisma.config.ts` (i.e. `DATABASE_URL`) directly against the schema,
which is what CI runs too, right after `db:migrate` in the same job — see
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — so a local pass and a CI pass mean
the same thing.

Resetting a local database from scratch:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
```

### Seeding a large board

The default seed is four tasks, which is the right size for developing a feature and the wrong
size for finding out what the board does under load. `SEED_LARGE_BOARD_TASKS` adds a second
board — "Load Test Board", five columns, the largest holding about a third of the tasks —
alongside the demo one:

```bash
SEED_LARGE_BOARD_TASKS=1000 pnpm db:seed
```

Unset or `0` (the default) skips it entirely, so nobody pays for it who did not ask. Anything
that is not a positive integer is treated the same as unset rather than clamped: a typo must
not quietly seed a board of some size other than the one you are about to measure against.

The rows are realistic rather than uniform — mixed priorities, labels on about half the cards,
assignees on a quarter, due dates spread across and past the due-soon window — because a board
where every card is the same shape measures one shape of card. This is the board the per-column
render budget in
[`apps/web/components/board/board-column.tsx`](../apps/web/components/board/board-column.tsx)
was measured against.

## Data retention

Kurul deletes rows it is no longer entitled to keep. A BullMQ job runs **once a day** on
`REDIS_URL` — the same mechanism as the due-soon scan — and sweeps six tables, plus the
attachment directory:

| Table                 | Deleted when                               | Setting                                      |
| --------------------- | ------------------------------------------ | -------------------------------------------- |
| `Session`             | `expiresAt` has passed                     | none — not configurable                      |
| `Verification`        | `expiresAt` has passed                     | none — not configurable                      |
| `Notification`        | read, and read more than N days ago        | `NOTIFICATION_RETENTION_DAYS` (default `90`) |
| `Activity`            | written more than N days ago               | `ACTIVITY_RETENTION_DAYS` (default `365`)    |
| `UsagePing`           | written more than N days ago               | `ACTIVITY_RETENTION_DAYS` (default `365`)    |
| `WorkspaceInvitation` | finished, and created more than N days ago | `INVITATION_RETENTION_DAYS` (default `90`)   |

**An invitation is "finished" in two ways, and both count:** somebody answered it (`status` is
anything other than `pending`) or its `expiresAt` has passed. A `pending` invitation whose expiry
is still ahead of it is a live grant of access somebody can still accept, so it is exempt at any
age. The window is measured from `createdAt` because that is the only timestamp the table has —
there is no `resolvedAt` — which deletes the record slightly earlier than measuring from the
answer would, bounded by how long a row can stay pending.

That sweep exists because `WorkspaceInvitation.email` is the one address in this schema that need
not belong to a user of the instance: invite somebody who never signs up and there is no account
for anyone to delete, so before this the row kept their address indefinitely. Deleting an account
now also removes every invitation addressed to it, in any state — see
[ADR 0026](decisions/0026-account-deletion-anonymisation.md).

The seventh sweep has no table. **Stored attachment files that no row claims are unlinked**, and
they exist because `Workspace → Board → Task → Attachment` cascades entirely inside Postgres:
deleting a board can remove thousands of attachment rows without a line of application code
running, so nothing is there to delete the bytes. The sweep is skipped outright when
`STORAGE_PATH` is unset, and it only considers files older than a **grace period** of
`BACKUP_KEEP × BACKUP_INTERVAL` — never less than 24 hours whatever those two say, because a
file whose row has not committed yet is also a file no row claims. The count it reports is
`orphanedFiles`; it is a number and never a list of keys, because a storage key is an
attachment's identity.

`UsagePing` deliberately shares `ACTIVITY_RETENTION_DAYS` rather than carrying a window of its
own: it is the same class of row — instance history naming a user — and two settings on one
class of data can only ever disagree with each other. See
[ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md) for what that table stores
(one deduplicated row per person, workspace, kind and UTC day) and what it deliberately does not.

The reasoning behind each window — and why `Activity` is deleted at a year rather than
archived or kept — is [ADR 0020](decisions/0020-data-retention.md).

Two things worth knowing before you change any of this:

- **Unread notifications are never deleted, at any age.** The window is measured from
  `readAt`, not from `createdAt`. Pending, unexpired invitations get the same exemption.
- **`0` means "keep forever"** for every window. Set `ACTIVITY_RETENTION_DAYS=0` if you have
  a statutory duty to retain an audit trail. A negative value is refused at startup rather
  than clamped — it would be a cutoff in the future, which would delete live rows.

Each run writes one JSON line to stdout with the number of rows deleted per table and nothing
else — no identifiers, no payloads:

```json
{
  "ts": "2026-08-14T03:00:01.204Z",
  "level": "info",
  "event": "retention.cleanup",
  "durationMs": 41.8,
  "sessions": 132,
  "verifications": 9,
  "notifications": 2140,
  "activities": 0,
  "usagePings": 0,
  "invitations": 4,
  "orphanedFiles": 0
}
```

The line is written even when every count is zero, so its absence is a signal that the job
stopped running.

`CLEANUP_ENABLED=false` disables the sweep completely, at the point of deletion rather than
only at startup — a job definition left in Redis by an earlier deployment cannot outlive the
switch. The integration suite runs with it off (`apps/api/test/setup-e2e.ts`) and turns it on around
its own assertions; a global scheduled `DELETE` is not something you want running in the
background of a suite whose fixtures are backdated rows.

Deleting is batched (1000 rows per statement) so a first run against a long-lived instance
never becomes one long transaction holding locks and blocking autovacuum.

## Activation funnel and telemetry

Two separate things, decided separately, and the difference between them matters more than
either one. The full reasoning is
[ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md).

### 1. The activation funnel — computed here, shown to you, sent nowhere

Kurul derives an eleven-step activation funnel from rows your instance already holds, plus a
North Star metric: **Weekly Active Team Workspaces** — workspaces with two or more members where
two or more current members did something in the last seven days.

| #   | Step                 | Where the number comes from                                         |
| --- | -------------------- | ------------------------------------------------------------------- |
| 1   | `user_registered`    | `COUNT(User)`                                                       |
| 2   | `workspace_created`  | distinct `WorkspaceMember.userId` with `role = OWNER`               |
| 3   | `board_created`      | distinct actors on the `board.created` activity                     |
| 4   | `first_task_created` | distinct actors on `task.created`                                   |
| 5   | `first_drag`         | distinct actors on `task.moved`                                     |
| 6   | `invite_sent`        | distinct actors on `invitation.created`                             |
| 7   | `smtp_configured`    | whether this deployment has an SMTP transport (not a headcount)     |
| 8   | `invite_accepted`    | distinct actors on `invitation.accepted` — the actor is the invitee |
| 9   | `dashboard_viewed`   | distinct users with a `dashboard_view` row in `UsagePing`           |
| 10  | `task_completed`     | distinct actors moving a card into a `COMPLETED` column             |
| 11  | `wau_board_view`     | distinct users with a `board_view` row in the last 7 days           |

Nine of the eleven are read from `Activity`, `User` and `WorkspaceMember` — tables the product
already writes for its own reasons — so the funnel covers your instance's whole history, not
just the period since you upgraded. Only steps 9 and 11 needed storage of their own, because
`Activity` records changes and _reading a board is not a change_: without them, a team that
opens the board every morning and edits nothing would be reported as dead.

Every step counts **distinct people**, never events, except step 7 which is a property of the
deployment. `smtp_configured` sits between "invite sent" and "invite accepted" on purpose: with
no mail transport an invitee cannot confirm their address and therefore cannot accept at all
(see [SMTP and Mailpit](#smtp-and-mailpit) and
[ADR 0013](decisions/0013-invitation-email-verification.md)), so a zero there explains a drop
that would otherwise look like a product problem.

**Nothing here leaves your server.** It is computed on demand and returned to one signed-in
caller over the same API as everything else.

#### Who can see it

Nobody, until you say so:

```dotenv
INSTANCE_ADMIN_EMAILS=you@example.com,ops@example.com
```

Blank — the default — means the endpoint answers `403` to everyone, including the account that
owns every workspace on the box. It has to: on an install with open registration, "owner of a
workspace" is a role any visitor can grant themselves by creating one, so no workspace role
could be the boundary. Addresses are matched case-insensitively and a restart is needed to
change the list.

A listed address only grants access once that account's own email is verified. Kurul does not
require email verification to sign in, and a deleted account's address is freed for a fresh
sign-up — so listing an address here does not, by itself, protect it: whoever proves ownership
of the mailbox first is who this list admits.

Once set, the funnel appears at the bottom of **Settings** for those accounts, and for nobody
else. There is no in-app way to grant it.

### 2. Outbound telemetry — off, and it stays off unless you switch it on

```dotenv
TELEMETRY_ENABLED=false          # the default
TELEMETRY_ENDPOINT=              # no default; required in addition to the switch above
```

With `TELEMETRY_ENABLED=false` — which is what an untouched `.env` means — **no outbound request
is made at all**. Setting it to `true` without also setting `TELEMETRY_ENDPOINT` logs an error
and still sends nothing; there is deliberately no built-in collector address.

When you do switch it on, exactly one `POST` is made when the API process starts, carrying this
body and **nothing else**:

```json
{
  "event": "instance_started",
  "version": "0.1.0"
}
```

Field by field, that is the whole list:

| Field     | Value                | Notes                                                 |
| --------- | -------------------- | ----------------------------------------------------- |
| `event`   | `"instance_started"` | Always this literal string. There is only one event   |
| `version` | e.g. `"0.1.0"`       | The `@kurul/api` package version this build came from |

What is **not** sent, and has no code path to be sent: any instance or installation identifier,
your hostname, your IP address, your URL, your database, any count of users, workspaces, boards
or tasks, any part of the activation funnel above, and anything at all about any person. There
is no session, no cookie, no fingerprint, and no second request — no retry, no queue, no
schedule. The payload is logged in full before it is sent, so you can read what left your server
in your own API log:

```text
LOG [TelemetryService] TELEMETRY_ENABLED is on — sending {"event":"instance_started","version":"0.1.0"} to https://…
```

A refused connection, a DNS failure, an error from the collector or a timeout
(`TELEMETRY_TIMEOUT_MS`, default 5s) all produce one warning line and nothing else — telemetry
can never delay or fail a boot.

Because there is no instance identifier, a collector can count _starts_ and not installs. That
is a deliberate loss of precision in exchange for a promise with nothing to take on trust; the
trade is argued out in [ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md).

## Upgrading and backups

This applies to anyone running Kurul with data they care about, not to throwaway local
databases. Pre-1.0, breaking schema changes can ship in any `0.y.0` release
([git-strategy.md](git-strategy.md#versioning-policy-semver)), so there are two rules: let
the scheduled backup run, and **take one more dump immediately before every upgrade.**

### The scheduled backup sidecar

`docker compose up` starts a `backup` service alongside `postgres`. It runs
[`scripts/backup.sh`](../scripts/backup.sh) from a `postgres:18-alpine` container — the same
image as the server, so `pg_dump`/`pg_restore` always match the server major — and loops:

1. `pg_dump --format=custom` into the `backup_data` volume as
   `/backups/kurul-<UTC timestamp>.dump` (written as `.part` and renamed on success, so an
   interrupted dump never looks like a finished archive),
2. `tar -czf` the attachments volume — mounted read-only at `/attachments` — into
   `/backups/kurul-<the same UTC timestamp>-files.tar.gz`. The shared timestamp is how a
   restore knows which tar belongs to which dump,
3. delete everything past the newest `BACKUP_KEEP` archives **of each series**,
4. sleep `BACKUP_INTERVAL` seconds, repeat.

**The file archive is not a snapshot, and that limit is measured rather than assumed.**
`pg_dump` takes a consistent view of the database; `tar` takes whatever the directory looks like
as it walks it, so a file uploaded while the archive runs can end up truncated inside it. The
`.part`-then-rename discipline hides a half-written _archive_, not a half-written _file_. The
window is one `tar` of the attachments directory per `BACKUP_INTERVAL`, and the restore drill
below catches the case by comparing every restored file's size against the size its row records
— a count alone cannot, because a truncated file is still one file. Closing the window properly
means an LVM/ZFS snapshot or pausing uploads for the duration, neither of which a single-host
Compose install carries.

The defaults — one dump a day, seven kept — mean **a recovery point at most 24 hours old
(RPO ≤ 24 h) and a week of history**, with no cron on the host and nothing to remember. The
service is `restart: unless-stopped`: a backup sidecar that stays down after a reboot
silently stops producing recovery points, which is the failure this whole section exists to
prevent. It is deliberately **not** in `docker-compose.dev.yml` — a local database that
`pnpm db:seed` wipes on demand has nothing worth keeping.

Two settings, both read from `.env` by compose:

| Variable          | Default | Purpose                                                                   |
| ----------------- | ------- | ------------------------------------------------------------------------- |
| `BACKUP_INTERVAL` | `86400` | Seconds between cycles. `86400` = daily; this **is** your RPO             |
| `BACKUP_KEEP`     | `7`     | Archives of each series retained; older ones are deleted after each cycle |

Compose passes both to the `api` service as well, which is easy to miss because they read as
backup settings: the nightly orphan-file sweep refuses to delete a stored file while a dump old
enough to disown it is still restorable, and that grace period is exactly
`BACKUP_KEEP × BACKUP_INTERVAL`. "On disk with no row pointing at it" is a correct predicate
only while the database is authoritative, and a restore rewinds the rows while the disk stays
where it is — so shortening either variable shortens the window in which a restore is safe from
that sweep. **Never below 24 hours**, though: the API clamps the window to a day whatever these
two say, because the grace period also covers an upload whose bytes are on disk while its row is
still being written, and that has nothing to do with backups — it is there on an instance that
has never taken a dump. See [ADR 0022](decisions/0022-attachment-storage.md).

Check on it — an untested backup is not a backup, and neither is an unread log:

```bash
docker compose logs backup | tail            # two "wrote /backups/kurul-…" lines per cycle
docker compose exec backup ls -lh /backups   # newest pair, and how many are kept
```

Two lines per cycle, not one: a cycle that logged only the dump means the file archive failed
(or `ATTACHMENT_DIR` is unset), and the `ERROR` line above it says which.

**Copy the archives off-host.** `backup_data` sits on the same disk as `postgres_data`, so it
covers "I dropped the wrong table" and covers nothing about a dead disk or a lost server —
mirror the volume somewhere else on a schedule (`rsync`/`rclone` from
`docker compose exec -T backup cat /backups/<archive>`, or straight from the volume's host
path) or the disaster case still loses everything.

### Taking a dump by hand

Before an upgrade, or any time you want a recovery point now rather than up to
`BACKUP_INTERVAL` from now, run the same script once — it writes both archives into the same
volume, under one timestamp, and prunes by the same rule:

```bash
docker compose exec backup /bin/sh /usr/local/bin/backup.sh once
```

To hold a copy outside the volume (recommended before an upgrade, since it survives a
`docker compose down -v`) — the dump, and the files beside it:

```bash
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres \
  pg_dump -U kurul --format=custom kurul > "kurul-$stamp.dump"
docker compose run --rm -T --entrypoint tar backup -czf - -C /attachments . \
  > "kurul-$stamp-files.tar.gz"
```

One `stamp` for both, for the same reason the sidecar shares one: the pair is only useful
together, and a tar whose dump you cannot identify is a directory of files with no rows.

- Read the `CHANGELOG.md` entry for the target version first — every breaking change carries
  a migration note there.
- Then upgrade the images and run the migrations.
- If the upgrade goes wrong, see [Rollback](#rollback).

### Restoring from a backup

**Target: back up in under two hours (RTO ≤ 2 h) from the decision to restore.** The
procedure below runs in seconds on a small instance; the budget is for the deciding, the
finding of the right archive, and the verifying. It has been rehearsed end to end — a database
dumped and archived by `scripts/backup.sh`, restored into an empty server with the matching file
archive, reproduced all 20 tables, every row count, all 71 indexes, `pg_trgm`, the
`_prisma_migrations` table, and **every attachment file at the byte size its row records**. The
last clause is the one this drill grew: a restore that brings the rows back and leaves the files
behind passes every check written before attachments existed.

Restore is `pg_restore` (the archives are `--format=custom`, not SQL text), and it wants an
**empty** database — restoring over a populated one produces duplicate-key errors, not a
clean overwrite.

```bash
# 1. Stop everything that writes — including the backup sidecar, so it cannot dump the
#    half-restored database and rotate a good archive out. Postgres itself stays up.
docker compose stop web api backup

# 2. Pick the pair to restore — a `.dump` and the `-files.tar.gz` with the SAME timestamp.
#    `run --rm` because the sidecar is stopped now; the throwaway container mounts the same
#    backup_data volume.
docker compose run --rm --entrypoint ls backup -1 /backups

# 3. Recreate the database empty. This is the destructive step — everything written after
#    the archive was taken is gone from here on.
docker compose exec -T postgres psql -U kurul -d postgres \
  -c 'DROP DATABASE kurul WITH (FORCE);' \
  -c 'CREATE DATABASE kurul OWNER kurul;'

# 4. Restore. --exit-on-error turns a partial restore into a loud failure instead of a
#    half-populated database that looks fine.
docker compose run --rm --entrypoint pg_restore backup \
  --host=postgres --username=kurul --dbname=kurul \
  --no-owner --exit-on-error /backups/kurul-<timestamp>.dump

# 4b. Restore the attachment files that belong to the SAME timestamp. The `backup` service
#     mounts the volume read-only, so this needs its own writable mount — and `--user 1000:1000`,
#     because the files belong to the api's `node` user and this stack runs `cap_drop: [ALL]`,
#     which takes CAP_DAC_OVERRIDE away from root. Without the flag, `rm` fails with
#     "Permission denied" on a container that is nominally root. Measured, not predicted.
docker compose run --rm --user 1000:1000 -v kurul_attachment_data:/restore \
  --entrypoint sh backup -c \
  'rm -rf /restore/* && tar -xzf /backups/kurul-<timestamp>-files.tar.gz -C /restore'

# 5. Check the migration state. The archive carries _prisma_migrations, so the recorded
#    state matches the restored schema and this should report nothing to do.
docker compose run --rm migrate

# 6. Verify before letting traffic back in: schema, row counts, and that the files came back.
docker compose exec -T postgres psql -U kurul -d kurul \
  -c '\dt' \
  -c 'SELECT count(*) FROM "User";' \
  -c 'SELECT count(*) FROM "Workspace";' \
  -c 'SELECT count(*) FROM "Task";' \
  -c 'SELECT count(*) FROM "Attachment" WHERE kind = '"'"'FILE'"'"';' \
  -c 'SELECT count(*) FROM "_prisma_migrations";'
docker compose run --rm --entrypoint sh backup -c 'find /attachments -type f | wc -l'

# 6b. And that every restored file is the size its row says it is. This is what catches a file
#     `tar` copied while it was still being written — a count alone cannot: a truncated file is
#     still one file.
#
#     Plain POSIX on purpose: temp files and `diff a b`, not `diff <(…) <(…)`. Process
#     substitution is a bash/zsh feature, and this block gets pasted into `sh` more often than
#     anyone admits, where it fails with a syntax error that reads like a broken backup.
#
#     `find -exec stat -c`, not `find -printf`: the backup container is postgres:18-alpine and
#     BusyBox `find` has no `-printf`. One command, not a choice — an operator should not have
#     to make a portability decision in the middle of a restore.
docker compose exec -T postgres psql -U kurul -d kurul -At \
  -c 'SELECT "storageKey" || '"'"' '"'"' || "size" FROM "Attachment" WHERE kind = '"'"'FILE'"'"';' \
  | sort > /tmp/expected.txt
docker compose run --rm --entrypoint sh backup -c \
  'cd /attachments && find . -type f -exec stat -c "%n %s" {} + | sed "s|^\./||"' \
  | sort > /tmp/actual.txt
diff /tmp/expected.txt /tmp/actual.txt && echo "every file restored at its recorded size"

# 7. Bring the stack back.
docker compose up -d
```

The drill passes on **three** things, not two:

1. the `FILE` attachment row count equals the number of files on disk,
2. `diff` in 6b is empty — every file is the size its row records,
3. if anything was uploaded while the archive was being taken, a difference may appear **only**
   for files in that window, and `diff` names them. A silent difference is never acceptable:
   reported, the `tar`-is-not-a-snapshot limit above has been measured; unreported, it has only
   been written down.

`kurul_attachment_data` in step 4b is the volume's full name, which Compose prefixes with the
project name — `docker volume ls` if your directory is not called `kurul`.

If the checked-out code is newer than the archive's schema, step 5 applies the missing
migrations forward, which is correct. If it is **older**, check out the release tag that
matches the archive before step 5 — see [Rollback](#rollback).

Restoring from a host-side file instead of one in the volume (step 4 variant):

```bash
docker compose run --rm -T --entrypoint pg_restore backup \
  --host=postgres --username=kurul --dbname=kurul --no-owner \
  --exit-on-error < kurul-20260813T194856Z.dump

# The file half, same idea (step 4b variant) — writable mount, and uid 1000 for the same
# CAP_DAC_OVERRIDE reason.
docker compose run --rm -T --user 1000:1000 -v kurul_attachment_data:/restore \
  --entrypoint sh backup -c 'rm -rf /restore/* && tar -xzf - -C /restore' \
  < kurul-20260813T194856Z-files.tar.gz
```

**PostgreSQL major-version upgrades need a dump and restore.** The official `postgres` image
refuses to start when the `PGDATA` volume was initialized by a different major version
("database files are incompatible with server"); the volume does not migrate itself. To move
from one major to the next: `pg_dump` on the old image, start the new major against an empty
volume, `psql`/`pg_restore` the dump. Minor upgrades (18.4 → 18.5) are in-place and need no
dump — the pre-upgrade backup above is still the sane habit.

**Redis is not backed up.** It holds cache, sessions, rate-limit counters, the Socket.io
pub/sub fan-out, and the notification queue — all rebuildable. Losing it logs everyone out
and drops queued notifications that had not been delivered yet; it loses no board data.
Redis upgrades within a major, and 7 → 8, are in-place and RDB/AOF compatible.

**Attachment files are backed up, for the opposite reason.** `attachment_data` holds the only
bytes in this stack that are neither in Postgres nor rebuildable from it: the row survives a
lost volume and the download does not. That is why the sidecar archives it beside the dump and
why the drill above checks the files as well as the rows — ADR 0020 rejected cold-storage
archiving as "a file on the same disk that nobody reads and nobody restores", and the answer is
not that users can see these files, but that this copy is read and restored on the same
rehearsed schedule as the dump.

### Undoing an account deletion

**There is no undo in the product, and this is the whole of the answer.** `DELETE /me` and
`DELETE /instance/users/:userId` anonymise the `User` row in place and hard-delete the rows that
were only ever about that person ([ADR 0026](decisions/0026-account-deletion-anonymisation.md)).
Both are immediate and neither is reversible from the application — which is deliberate, because
an erasure request that can be quietly rolled back is not an erasure.

So the recovery path is the dump, and it is the restore drill above with **one change**: restore
into a scratch database, never over the live one. Everything written since the archive was taken
is still in the live database, and a full restore would throw all of it away to recover one row.

```bash
# 1. A scratch database beside the live one, from the newest dump that predates the deletion.
docker compose exec -T postgres psql -U kurul -d postgres \
  -c 'CREATE DATABASE kurul_recovery OWNER kurul;'
docker compose run --rm --entrypoint pg_restore backup \
  --host=postgres --username=kurul --dbname=kurul_recovery \
  --no-owner --exit-on-error /backups/kurul-<timestamp>.dump

# 2. Find the account. The log line the deletion wrote carries the id and nothing else —
#    `docker compose logs api | jq 'select(.event == "account.deleted")'` — so start there;
#    the scratch database is what turns that id back into a name.
docker compose exec -T postgres psql -U kurul -d kurul_recovery \
  -c 'SELECT id, email, name FROM "User" WHERE id = '"'"'<userId>'"'"';'
```

What can be copied back, and what cannot:

| Row                                             | Recoverable                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `User` (email, name, avatarUrl, locale)         | Yes — `UPDATE "User" SET … WHERE id = …` on the live database, and clear `deletedAt`                    |
| `Account` (the password hash)                   | Yes — copy the row back, or have the person reset their password                                        |
| `WorkspaceMember`                               | Yes, if the workspaces still exist; re-add at the role the `account.deleted` payload records            |
| `Comment` bodies whose mentions were rewritten  | Yes — the old body is in the dump                                                                       |
| `Activity.payload.targetName`                   | Yes, same way                                                                                           |
| **A workspace a disposition deleted**           | **Only from the dump, wholesale.** It cascaded — boards, tasks, comments and all                        |
| `WorkspaceInvitation` rows carrying the address | **Only from the dump.** Every invitation addressed to the account is deleted — any state, any workspace |
| `Session`                                       | No, and no reason to: the person signs in again                                                         |

**The invitation rows are the newest thing on that list, and the only one where the erasure
deletes rather than anonymises.** Both sides of the table are touched: the pending invitations the
account had _sent_ are revoked (a deleted account cannot keep vouching for anybody), and every
invitation _addressed to_ it is deleted outright in any state, because that row is a copy of the
departing person's own contact details rather than somebody else's record of an event
([ADR 0026](decisions/0026-account-deletion-anonymisation.md)).

Copying one back is almost never what you want: re-inviting the address issues a fresh grant with
a fresh expiry, which is what the admin wanted anyway, so the dump is worth reading only for the
historical question — was this person ever invited to that workspace, and by whom. Note also that
the nightly sweep deletes finished invitations on its own schedule (`INVITATION_RETENTION_DAYS`),
so a dump older than that window may not carry the row either.

**Attachment bytes survive**, and there is a clock on them. This flow never touches the
filesystem, so the files are where they were — but the nightly orphan sweep deletes a stored file
once no row claims it and the grace window has passed
(`BACKUP_KEEP × BACKUP_INTERVAL`, at least 24 hours — [ADR 0022](decisions/0022-attachment-storage.md)).
If a deleted workspace has to be restored, restore it **inside that window**, or the rows come
back pointing at files that are gone. `docker compose stop api` buys time: the sweep runs in the
API process.

Drop the scratch database when you are finished with it — it is a full copy of the instance's
data, sitting beside the instance:

```bash
docker compose exec -T postgres psql -U kurul -d postgres \
  -c 'DROP DATABASE kurul_recovery WITH (FORCE);'
```

### Index migrations take a write lock

**Every index in `apps/api/prisma/migrations/` is created with a plain `CREATE INDEX`, which
takes a `SHARE` lock on the table for the whole build.** Reads continue; **writes to that
table block until the index finishes.** On a fresh or small database this is milliseconds and
invisible. On a large one it is a write outage lasting as long as the build.

The two that matter most are the trigram GIN indexes in
`20260809190000_task_trgm_search_indexes` — `Task_title_idx` and `Task_description_idx`. GIN
builds over text are among the slowest index builds there are, and `Task` is the
fastest-growing table in the schema.

This is a deliberate trade-off, not an oversight. `CREATE INDEX CONCURRENTLY` cannot run
inside a transaction block, and `prisma migrate deploy` wraps each migration in one — so
using it would mean hand-writing migrations Prisma cannot apply, in exchange for a lock that
is imperceptible on every database this project has actually been deployed to. Prisma's own
guidance for the case is the manual path below.

**Before upgrading an instance with a large `Task` table (roughly: past a few hundred
thousand rows), or any instance that cannot take a write pause:**

1. Read the new migrations in the release before applying them:
   `git diff <current-tag>..<target-tag> -- apps/api/prisma/migrations`.
2. If one creates an index on a large table, apply that statement yourself first, with
   `CONCURRENTLY`, while the old version is still serving traffic:

   ```bash
   docker compose exec -T postgres psql -U kurul kurul -c \
     'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_title_idx" ON "Task" USING GIN ("title" gin_trgm_ops);'
   ```

   `CONCURRENTLY` does not block writes, but it cannot run inside a transaction and takes
   roughly twice as long. If it fails it leaves an **invalid** index behind, which must be
   dropped (`DROP INDEX CONCURRENTLY "Task_title_idx";`) before retrying — check with
   `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`.

3. Then run `pnpm db:migrate` as usual. The migration's own `CREATE INDEX` is a no-op against
   an index that already exists under the same name, so the deploy takes no lock.

Do not do this routinely — for a normal-sized instance, step 3 alone is correct and the whole
procedure is wasted effort. It is a release-note-driven escape hatch for the one case where
the default would hurt.

`CREATE EXTENSION IF NOT EXISTS pg_trgm` in that same migration needs superuser or
`pg_database_owner` rights. A managed Postgres that restricts extensions must have `pg_trgm`
enabled by its provider before the migration runs.

## Rollback

What to do when an upgrade or release goes bad and the last known-good version has to come
back. Two different things can need rolling back, and they move independently: the
**application** (the code the containers run) and the **database schema** (the applied Prisma
migrations). Rolling the application back is cheap and fast; rolling a migration back is not —
read the migration part before you need it at 2 a.m.

### Rolling back the application

`api`/`web` are published to GHCR on every tagged release (see
[Full stack in Docker](#full-stack-in-docker)), so rolling back is a tag change, not a
rebuild:

```bash
# .env
TAG=v0.1.0   # the last known-good tag — list published versions with `git tag -l`
```

```bash
docker compose pull && docker compose up -d   # pulls v0.1.0's images and restarts on them
```

No image published for that tag (older installs upgraded before this workflow existed, or
`ghcr.io` is unreachable from this host)? Fall back to the source rebuild this used to be the
only option for:

```bash
git fetch --tags
git switch --detach v0.1.0        # the last known-good tag — list them with `git tag -l`
docker compose up -d --build      # rebuild api + web from that tree and restart
```

The one-shot `migrate` service runs on every `up`, but it only **applies** migrations that
exist in the checked-out tree (`prisma migrate deploy`) — it never reverts migrations the
database has that the tree does not. So after a code rollback the database keeps the newer
schema. If the bad release's migrations were purely additive (new tables, new nullable
columns, new indexes), the older code runs fine against that schema and the code rollback
alone is the whole procedure. If the bad release renamed or dropped something the older code
reads, a code-only rollback will crash on boot — that is the migration-rollback case below.

### Rolling back a migration

**Prisma does not generate down migrations.** Every directory under
`apps/api/prisma/migrations/` contains a forward-only `migration.sql`; there is no
`migrate down` command and no automated revert path. The options, in order of preference:

1. **Forward-fix (preferred).** Write a **new** migration that undoes or repairs the bad
   change — drop the bad column, restore the old name, backfill the data — author it locally
   with `pnpm db:migrate:dev`, and deploy forward as usual. History stays linear, no data is
   thrown away beyond what the bad migration itself destroyed, and no committed migration
   file is ever edited. Ship it through the hotfix flow below.
2. **Restore from a backup.** The `backup` sidecar gives you one at most `BACKUP_INTERVAL`
   old (24 hours by default), and [the section above](#upgrading-and-backups) says to take
   one more immediately before every upgrade — that fresher archive is the one you want here.
   Everything written after the archive was taken is **permanently lost**: the recovery point
   is the moment `pg_dump` ran, so on a live instance this trades user data for schema. Use
   it when the bad migration itself destroyed data (dropped a column or table) that the
   archive still has.

   Follow [Restoring from a backup](#restoring-from-a-backup) in full, with one addition —
   move the stack onto the release tag that matches the archive before you bring it back, so
   the code and the schema agree: set `TAG=v0.1.0` in `.env` and `docker compose pull` (see
   [Rolling back the application](#rolling-back-the-application)), or, if that tag has no
   published image, `git switch --detach v0.1.0 && docker compose up -d --build`.

   The archive contains the `_prisma_migrations` bookkeeping table, so after the restore the
   recorded migration state matches the restored schema, and the old release's `migrate`
   service finds nothing left to apply.

3. **`prisma migrate resolve` — marking, not reverting.** `resolve` edits only the
   `_prisma_migrations` bookkeeping table; it changes no schema and restores no data. Its
   scenario is a migration that **failed halfway** and now blocks every `migrate deploy`:
   repair the database by hand (or restore it), then — from `apps/api` — either
   `pnpm exec prisma migrate resolve --rolled-back <migration_name>` so the next deploy
   retries it, or `--applied <migration_name>` so the next deploy skips it. Reaching for it
   to "undo" a migration that succeeded does nothing to the schema — that misuse only makes
   the bookkeeping lie.

### Never `migrate reset` in production

`prisma migrate reset` drops and recreates the entire database. It is a dev-loop convenience
for throwaway local data, never a rollback tool, and nothing stops it from pointing at
production except the `DATABASE_URL` in your shell. The seed is the same shape of hazard:
`pnpm db:seed` starts by deleting **every row in every table** before inserting demo data,
which is why [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts) refuses to run when
`NODE_ENV` is `production`
([`apps/api/src/common/seed-guard.ts`](../apps/api/src/common/seed-guard.ts)) — deliberately
with no override flag. `migrate reset` has no such guard. The rule at 2 a.m. is absolute:
neither command ever runs against a database you cannot afford to recreate from a dump.

### Rollback and the hotfix flow

A rollback buys time; it is not the fix. The durable fix ships as a `hotfix/*` branch from
`main` — [git-strategy.md](git-strategy.md#hotfix-process): branch, fix (including any
forward-fix migration from option 1 above), bump the patch version, PR into `main`, tag,
back-merge to `develop`, then upgrade production onto the new tag — which is also what ends
the rollback. If the bad release was `v0.2.0` and production is parked on `v0.1.0`, the
hotfix ships as `v0.2.1`; do not stay parked on the old tag longer than it takes to ship it.

## Observability

Three signals, three destinations. Nothing here is a metrics stack — no Prometheus, no
Grafana, no log shipper. At Kurul's scale the question worth answering is "did something
break, and did anyone notice", and that needs exactly this much:

| Signal                   | Where it goes                                             | Configured in                                   |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------- |
| Request and process logs | container stdout → Docker `json-file`, capped and rotated | `docker-compose.yml` (`x-logging`)              |
| Unhandled errors (5xx)   | Sentry, **only if you configure a DSN**                   | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`         |
| The instance being down  | an external uptime monitor polling `/health/ready`        | your monitor's dashboard — nothing in this repo |

The three join up on one identifier. Every request gets an `X-Request-Id` (reused from an
upstream proxy when it sends one, minted as a UUIDv7 otherwise); it is echoed to the client,
written into the JSON access-log line, appended to the server-side stack trace, and — when
error tracking is on — attached to the Sentry event as a searchable `requestId` tag. A user
reporting "it broke, the page said `0198e2c1-…`" is one `grep` and one Sentry search away
from the exact failure.

### Logs

Both apps log to stdout; Docker collects it. `docker compose logs -f api` reads it back.

The API writes one JSON object per finished request — `ts`, `level`, `requestId`, `method`,
`path`, `status`, `durationMs`, `userId`. That field list is closed on purpose: request
bodies, query strings, headers and cookies are never logged, because this API carries session
cookies, invitation tokens and task content.

Every service in both compose files caps its logs at **3 files × 10 MB** (`x-logging` at the
top of `docker-compose.yml`). Docker's `json-file` default is _unbounded_, and a full disk is
its own outage — one this stack could reach on its own, since the access log grows with
traffic. The setting is applied when a container is **created**, so an existing deployment
needs a `docker compose up -d` (which recreates containers) for it to take effect; a plain
`restart` will not do it. Verify with:

```bash
docker inspect kurul-api-1 --format '{{json .HostConfig.LogConfig}}'
# {"Type":"json-file","Config":{"max-file":"3","max-size":"10m"}}
```

### Error tracking (Sentry) — off by default

Kurul ships with error tracking **disabled**, and disabled means the SDK is never loaded:
no initialization, no global handlers, no outbound connection, and on the web side no Sentry
chunk requested by the visitor's browser. Self-hosted software that quietly opens a telemetry
pipeline nobody asked for is not something this project ships; leaving the DSNs blank is a
supported, permanent configuration.

To turn it on, set the DSNs in `.env`:

```bash
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>              # API
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>  # web
SENTRY_ENVIRONMENT=production            # optional; falls back to NODE_ENV
SENTRY_RELEASE=v0.2.0                    # optional; set it to the tag you deployed
```

then `docker compose up -d --build web && docker compose up -d api`. The API reads its DSN at
container start, so a restart is enough. The web DSN is a `NEXT_PUBLIC_*` value, which Next.js
inlines at **build** time — the web image must be rebuilt for a change to take effect. (This is
the same mechanism that used to force a rebuild for `NEXT_PUBLIC_API_URL`; that one no longer
does, because the value baked into it is a same-origin path rather than a deployment's
hostname — see [Full stack in Docker](#full-stack-in-docker).)

Use **two Sentry projects**, one per app. The browser DSN is compiled into JavaScript every
visitor downloads, so it is public by construction; it should not be the same DSN your server
uses. Self-hosted Sentry works the same way — the DSN just points at your own host.

**What is reported, and what is not.** The API reports 5xx and only 5xx: an unmapped Prisma
error, a bug that threw, a `throw` of something that is not an `Error`. Client errors — 400,
401, 403, 404, 409, 429 — are never sent. They are the API working as designed, they are
already counted in the access log, and shipping thousands of them a month is how an alerting
channel stops being read.

**What leaves the process.** `sendDefaultPii` is off, and a `beforeSend` hook strips, on both
sides:

- the `cookie`, `set-cookie`, `authorization` and `proxy-authorization` headers — a captured
  session cookie is a session handed to anyone who can read the Sentry project;
- all cookies, request/response bodies, and query strings (`?q=` carries search terms, which
  are user content);
- everything on `user` except `id` — no email, no username, no IP address. The `id` is an
  opaque UUIDv7, the same one the access log already writes.

What is kept: the exception type, message and stack; the request method and route path; the
`requestId` tag; and `user.id`. **Performance tracing and Session Replay are pinned off**
(`tracesSampleRate: 0`, both replay rates `0`) and are not exposed as settings — replay would
ship the rendered DOM, meaning every task title and comment on screen, and tracing would need
the SDK preloaded before the app boots, which is incompatible with "not loaded unless you
asked for it".

**Source maps.** The Sentry build plugin runs only when `NEXT_PUBLIC_SENTRY_DSN` is set, and
even then it uploads nothing unless `SENTRY_AUTH_TOKEN` is also present — so a build without a
token never fails and never warns. Without upload, browser stack traces stay minified; set
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` at build time for readable ones. The
plugin's own build-time telemetry is disabled unconditionally.

### Uptime monitoring — set this up, it is the one that catches an outage

Restart policies bring a crashed container back, but nothing tells you when the host itself is
down, the disk filled, or Postgres stopped accepting connections. An external monitor is the
only signal that survives the machine it is watching, and the free tier of any of them is
enough.

**Monitor `/health/ready`, not `/health`.** They answer different questions:

| Endpoint        | Question                                                                               | Behaviour                                                               |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/health`       | Is the process up and answering HTTP?                                                  | Static `{"status":"ok"}` — touches nothing. Always 200 if Node is alive |
| `/health/ready` | Can this instance actually serve requests — is Postgres reachable, is Redis answering? | `200` with a `checks` breakdown, or `503` when a dependency is down     |

`/health` is a liveness probe: it is what an orchestrator uses to decide whether restarting
the process would help, and it deliberately stays green while the database is on fire, because
a restart cannot heal the database. Monitoring it would tell you the API is "up" during an
outage in which no user can load a board. `/health/ready` is the one that goes red when the
product is actually broken, and its response body names the dependency that failed. Both are
public (no auth) and exempt from rate limiting, so a monitor cannot throttle itself into a
false alarm.

Setup, with [UptimeRobot](https://uptimerobot.com) or
[healthchecks.io](https://healthchecks.io) as examples — any monitor that can poll a URL and
send email works:

1. Create an **HTTP(s) monitor** for `https://<your-host>/api/health/ready`.

   The `/api` prefix is not optional on a deployed stack, and leaving it off fails in the way
   that is hardest to notice. The bundled `proxy` routes `/api/*` to the API and everything else
   to the web app (`docker/Caddyfile`), so `https://<your-host>/health/ready` matches the
   catch-all rule, reaches Next.js, and answers `307` with a redirect to `/login`. Against rule
   4 below that monitor is red on a perfectly healthy instance — and the natural fix, widening
   the accepted statuses until it goes quiet, makes it green during a real outage too. Only a
   dev-loop API running on its own port, with no proxy in front of it, is reachable at
   `http://localhost:4000/health/ready`.

2. **Interval: 5 minutes.** Fast enough that a nightly outage is caught before morning, slow
   enough to stay inside every free tier.
3. **Failure threshold: 2 consecutive failures** before alerting — one missed poll during a
   deploy or a `docker compose up -d` is not an incident, and an alert channel that cries wolf
   gets muted.
4. **Expected status: 200.** A `503` from `/health/ready` is a real dependency failure and must
   count as down; do not widen the accepted range to "any 2xx/3xx/5xx".
5. **Timeout: 10 seconds.** The readiness probe bounds its own dependency checks at ~2s, so
   anything slower is the network or a wedged process.
6. Attach an **email alert contact** and enable the "back up" notification too — knowing when
   it recovered is half of knowing what happened.
7. **Trigger it once on purpose** and confirm the mail arrives: `docker compose stop postgres`,
   wait for two intervals, expect a red alert, then `docker compose start postgres` and expect
   the recovery mail. An alerting setup that has never fired is a hypothesis, not a safeguard.

If the API is not yet reachable from the internet, healthchecks.io's _push_ model is the
alternative: it alerts when it **stops** hearing from you, so a host-side cron covers a private
deployment without exposing anything. Probe it the same way the container's own healthcheck
does, from inside the network rather than through a published port — on a Docker deployment the
API has none:

```cron
*/5 * * * * cd /opt/kurul && docker compose exec -T api wget -qO- http://127.0.0.1:4000/health/ready >/dev/null && curl -fsS <ping-url>
```

## Day-to-day loop

```bash
# 1. Start from an up-to-date develop and branch
git switch develop && git pull
git switch -c feature/board-drag-and-drop

# 2. Bring the services up (once per session)
docker compose -f docker-compose.dev.yml up -d
pnpm dev

# 3. Write code + tests

# 4. Verify locally before pushing
pnpm lint
pnpm build
pnpm --filter @kurul/api test

# 5. Commit in Conventional Commits format, in English
git commit -m "feat(web): add drag-and-drop to the kanban board"

# 6. Push and open a PR against develop
git push -u origin feature/board-drag-and-drop
```

CI runs the same lint, typecheck, and test steps on every PR — running them locally first
just saves a round trip. Branch naming, commit format, and the PR/release process are
specified in [git-strategy.md](git-strategy.md).

## Troubleshooting

| Symptom                                        | Cause                                                             | Fix                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:5432`                  | Postgres container is not up                                      | `docker compose -f docker-compose.dev.yml up -d`                              |
| `Environment variable not found: DATABASE_URL` | `.env` missing                                                    | `cp .env.example .env` and fill it in                                         |
| Port 3000/4000/5432 already in use             | Another process or a stale container                              | `docker compose down`, or change the port in `.env`                           |
| Prisma types out of date after pulling         | Client not regenerated — `pnpm db:migrate` does not regenerate it | `pnpm db:generate` (after applying any new migrations with `pnpm db:migrate`) |
| Freshly generated client not picked up         | A running `pnpm dev` keeps the old client in `dist`               | Restart `pnpm dev` after `pnpm db:generate` — assets are copied at (re)start  |
| `pnpm install` fails with a workspace error    | Ran inside a sub-package                                          | Run it from the repository root                                               |

## See also

- [architecture.md](architecture.md) — the module map and critical field rules this
  document is the contract for
- [self-hosting.md](self-hosting.md) — putting a release on your own domain: DNS, HTTPS, SMTP
- [../ROADMAP.md](../ROADMAP.md) — phase order
- [git-strategy.md](git-strategy.md) — branches, commits, releases
- [coding-standards.md](coding-standards.md) — how the code inside these apps is written
- [testing.md](testing.md) — how to run and write tests
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contribution process
