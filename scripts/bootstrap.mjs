#!/usr/bin/env node
/**
 * Takes a fresh clone with `.env` filled in to a running dev loop, in one command.
 *
 * ## Why this exists
 *
 * The dev loop's setup was six commands after `pnpm install`, and two of them are the kind
 * nothing reminds you about: `packages/shared-types` and `packages/auth-access` are consumed
 * from a git-ignored `dist/`, and the Prisma client is generated into a git-ignored directory
 * with no `postinstall` hook behind it. Skip either and the failure reads like a broken
 * checkout rather than a missing step — `Failed to resolve entry for package
 * "@kurul/shared-types"`, `TS2307: Cannot find module '@kurul/shared-types'`, or a seed that
 * dies on `@kurul/auth-access/dist/cjs/index.js` before it ever reaches the database. That
 * class of error costs a newcomer an hour and a maintainer a support thread, and neither of
 * them learns anything from it.
 *
 * So the sequence lives here instead of in a README the reader is asked to replay by hand.
 * It is deliberately the *same* commands documented in docs/development.md, in the same
 * order, run through `pnpm` — not a second, faster path that can drift from the documented
 * one. If this script and that page disagree, one of them is a bug.
 *
 * ## Re-running it is safe, and that is a design constraint rather than a nicety
 *
 * The steps are idempotent with one exception, and the exception is the reason this script
 * checks rather than just runs: `pnpm db:seed` **deletes before it inserts**. A script you are
 * told to run "after every pull" must not be a script that silently wipes the board you were
 * working on, so seeding happens only when the database has no `Workspace` row yet. Pass
 * `--seed` to force it (accepting the wipe) or `--no-seed` to skip it outright.
 *
 * Node built-ins only, and no import from the workspace: this runs on a checkout where
 * nothing is built yet, which is the whole point.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEV_COMPOSE = ['-f', join(ROOT, 'docker-compose.dev.yml')];

const args = new Set(process.argv.slice(2));
const FORCE_SEED = args.has('--seed');
const SKIP_SEED = args.has('--no-seed');

let step = 0;
const total = 7;

const say = (msg) => process.stdout.write(`${msg}\n`);
const heading = (msg) => say(`\n\x1b[1m[${++step}/${total}] ${msg}\x1b[0m`);
const note = (msg) => say(`      ${msg}`);

function fail(message, hint) {
  process.stderr.write(`\n\x1b[31mbootstrap failed:\x1b[0m ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  process.exit(1);
}

/** Run a command with its output attached to this terminal; exit on failure. */
function run(command, commandArgs, { hint } = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.error) fail(`could not run \`${command}\` — ${result.error.message}`, hint);
  if (result.status !== 0)
    fail(`\`${command} ${commandArgs.join(' ')}\` exited ${result.status}`, hint);
}

/** Run a command and capture stdout; returns null when it fails for any reason. */
function capture(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

/**
 * Read `.env` well enough to preflight it. This is not a dotenv implementation and does not
 * need to be — it answers one question ("is this variable set to something non-empty"), and
 * every value it is asked about is a secret the reader pasted on one line.
 */
function readEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) {
    fail(
      'no `.env` in the repository root.',
      '\n  cp .env.example .env\n\n' +
        'Then set POSTGRES_PASSWORD (openssl rand -hex 32) and BETTER_AUTH_SECRET\n' +
        '(openssl rand -base64 32) — see docs/development.md#environment-variables.',
    );
  }
  const env = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    env.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
  }
  return env;
}

// ---------------------------------------------------------------------------------------
// 1. Preflight
// ---------------------------------------------------------------------------------------
// Everything checked here fails *later* anyway — but later means after a Docker pull and a
// health-check wait, with an error that names neither `.env` nor the variable. Checking costs
// milliseconds and turns three separate confusing failures into one sentence.

heading('Checking prerequisites');

const env = readEnv();

if (!env.get('POSTGRES_PASSWORD')) {
  fail(
    'POSTGRES_PASSWORD is empty in `.env`.',
    'It has no default — compose refuses to start without it. Generate one with\n' +
      '`openssl rand -hex 32` (NOT -base64: `/` and `+` break the connection URL it is\n' +
      'embedded in), then copy the same value into the password segment of DATABASE_URL\n' +
      'a few lines above it — compose does not keep the two in sync.\n' +
      'See docs/development.md#database-and-cache-credentials.',
  );
}

if (!env.get('BETTER_AUTH_SECRET')) {
  fail(
    'BETTER_AUTH_SECRET is empty in `.env`.',
    'Generate one with `openssl rand -base64 32`. Unlike POSTGRES_PASSWORD this value is\n' +
      'compared byte-for-byte rather than embedded in a URL, so base64 is the right generator.',
  );
}

const databaseUrl = env.get('DATABASE_URL') ?? '';
if (databaseUrl.includes('<POSTGRES_PASSWORD>')) {
  fail(
    'DATABASE_URL in `.env` still carries the `<POSTGRES_PASSWORD>` placeholder.',
    'Replace it with the POSTGRES_PASSWORD value you set. This is the host-side string\n' +
      '`pnpm dev` uses to reach localhost:5432; compose assembles its own for its containers,\n' +
      'which is why a wrong value here fails only once you run the app.',
  );
}

if (!capture('docker', ['compose', 'version'])) {
  fail(
    'Docker Compose v2 is not available.',
    'This script needs the `docker compose` plugin form; the v1 `docker-compose` binary is\n' +
      'not supported. Is Docker running? See docs/development.md#prerequisites.',
  );
}

note('`.env` looks complete, Docker Compose v2 is available.');

// ---------------------------------------------------------------------------------------
// 2. Shared packages
// ---------------------------------------------------------------------------------------
// Both are consumed from a git-ignored `dist/` by `pnpm dev`, `pnpm db:seed` and the app
// builds (the test suites read the packages' `src` directly and do not need this step).
// Rebuilt unconditionally rather than only when missing: a *stale* dist is the worse failure
// of the two, because it resolves, and an enum added since the last build reads back as
// `undefined` in every consumer rather than as a module-not-found error.

heading('Building shared packages (@kurul/shared-types, @kurul/auth-access)');
run('pnpm', ['-r', '--filter', '@kurul/shared-types', '--filter', '@kurul/auth-access', 'build']);

// ---------------------------------------------------------------------------------------
// 3. Prisma client
// ---------------------------------------------------------------------------------------

heading('Generating the Prisma client');
note('reads apps/api/prisma/schema.prisma — does not touch the database');
run('pnpm', ['db:generate']);

// ---------------------------------------------------------------------------------------
// 4. Containers
// ---------------------------------------------------------------------------------------

heading('Starting postgres, redis and mailpit');
run('docker', ['compose', ...DEV_COMPOSE, 'up', '-d']);

// Every service in docker-compose.dev.yml declares a healthcheck, so "is it up" has an
// authoritative answer and does not need to be guessed at with a sleep. `prisma migrate` on a
// Postgres that has accepted the TCP connection but not finished `initdb` is the failure this
// wait exists to prevent, and it is the one a first run hits.
//
// The service list is asked of compose rather than hardcoded, and `ps` is *restricted* to it,
// for a reason that used to be load-bearing and is now defense-in-depth: before OPS-04
// (2026-08-18 audit), docker-compose.dev.yml had no `name:` of its own, so it fell back to the
// same project as docker-compose.yml (the checkout's directory) and a plain
// `docker compose -f docker-compose.dev.yml ps` could also list `api`, `web`, `proxy` and
// `backup` if the full stack happened to be up under the same directory. `proxy` still
// declares no healthcheck at all (`backup` gained one for OPS-02), so an unrestricted
// "every service is healthy" could never become true and this would have waited out its
// deadline against containers it had no business inspecting. docker-compose.dev.yml now
// declares `name: kurul-dev`, so `ps` here only ever sees this file's own services regardless
// of what else is running — the explicit service list stays anyway as the cheaper,
// still-correct thing to ask for.
heading('Waiting for the containers to report healthy');

const devServices = (capture('docker', ['compose', ...DEV_COMPOSE, 'config', '--services']) ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

if (devServices.length === 0) {
  fail(
    'could not read the service list from docker-compose.dev.yml.',
    'Check it with `docker compose -f docker-compose.dev.yml config --services`.',
  );
}

const DEADLINE_MS = 120_000;
const startedAt = process.hrtime.bigint();
const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;

let healthy = false;
let lastSeen = '';

while (elapsedMs() < DEADLINE_MS) {
  const json = capture('docker', [
    'compose',
    ...DEV_COMPOSE,
    'ps',
    '--format',
    'json',
    ...devServices,
  ]);
  if (json) {
    // Compose emits one JSON object per line (not a JSON array) — parse per line.
    const services = json
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (services.length > 0) {
      lastSeen = services.map((s) => `${s.Service}=${s.Health || s.State}`).join(' ');
      // Every dev service must be present *and* healthy: a container compose has not created
      // yet is simply absent from `ps`, which an `every()` over the rows would read as consent.
      healthy =
        services.length === devServices.length && services.every((s) => s.Health === 'healthy');
      if (healthy) break;
    }
  }
  // Poll rather than block: `docker compose ps` is cheap and this loop is at most 2 minutes.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}

if (!healthy) {
  fail(
    `containers did not report healthy within ${DEADLINE_MS / 1000}s (last seen: ${lastSeen || 'nothing'}).`,
    'Inspect them with:\n' +
      '  docker compose -f docker-compose.dev.yml ps\n' +
      '  docker compose -f docker-compose.dev.yml logs postgres',
  );
}

note(`all healthy in ${(elapsedMs() / 1000).toFixed(1)}s`);

// ---------------------------------------------------------------------------------------
// 5. Migrations
// ---------------------------------------------------------------------------------------
// `db:migrate` (prisma migrate deploy) applies committed migrations and never creates one —
// which is what you want both on a fresh clone and after pulling someone else's work. Creating
// a migration from your own schema edit is `pnpm db:migrate:dev`, deliberately not run here.

heading('Applying migrations');
run('pnpm', ['db:migrate'], {
  hint:
    'If this reports it cannot reach the database, the password segment of DATABASE_URL in\n' +
    '`.env` probably does not match POSTGRES_PASSWORD — compose does not sync them.',
});

// ---------------------------------------------------------------------------------------
// 6. Demo data
// ---------------------------------------------------------------------------------------

heading('Seeding demo data');

/**
 * Ask Postgres directly whether this database already holds workspaces. Going through the
 * container's own `psql` avoids needing a client on the host and avoids importing the Prisma
 * client, which at this point in a first run has been generated but never loaded.
 *
 * A null answer (table missing, container busy, psql unhappy) is treated as "unknown", and
 * unknown means *do not seed* — the destructive branch is never the one taken on a guess.
 */
function workspaceCount() {
  const out = capture(
    'docker',
    [
      'compose',
      ...DEV_COMPOSE,
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${env.get('POSTGRES_PASSWORD')}`,
      'postgres',
      'psql',
      '-U',
      env.get('POSTGRES_USER') || 'kurul',
      '-d',
      env.get('POSTGRES_DB') || 'kurul',
      '-tAc',
      'SELECT COUNT(*) FROM "Workspace"',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (out === null) return null;
  const parsed = Number.parseInt(out.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

if (SKIP_SEED) {
  note('skipped (--no-seed)');
} else {
  const existing = FORCE_SEED ? 0 : workspaceCount();

  if (existing === null) {
    note('skipped — could not read the Workspace table, and seeding deletes before it inserts.');
    note('Run `pnpm db:seed` yourself if this is a fresh database.');
  } else if (existing > 0) {
    note(`skipped — this database already holds ${existing} workspace(s).`);
    note('`pnpm db:seed` deletes before it inserts; pass --seed to reseed anyway.');
  } else {
    run('pnpm', ['db:seed']);
  }
}

// ---------------------------------------------------------------------------------------

say('');
say('\x1b[32mReady.\x1b[0m Start the apps with:');
say('');
say('  pnpm dev');
say('');
say('  Web      http://localhost:3000');
say('  API      http://localhost:4000/health');
say('  Mailpit  http://localhost:8025');
say('');
