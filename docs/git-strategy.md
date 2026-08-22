# Git Strategy

Branch model, commit convention, PR process, and release procedure for Kurul.

> 🌐 English (canonical) | [Türkçe](tr/git-strategy.md)

## Contents

- [Branch model](#branch-model)
- [Branch naming](#branch-naming)
- [Conventional Commits](#conventional-commits)
- [Pull request process](#pull-request-process)
- [Release process](#release-process)
- [Hotfix process](#hotfix-process)
- [Versioning policy (SemVer)](#versioning-policy-semver)
- [Rules summary](#rules-summary)

## Branch model

Kurul uses **Git Flow**. Two branches are permanent; everything else is short-lived and
deleted after merge.

| Branch      | Lifetime    | Branches from | Merges into        | Purpose                                                 |
| ----------- | ----------- | ------------- | ------------------ | ------------------------------------------------------- |
| `main`      | permanent   | —             | —                  | Released code only. Every commit is a tagged release.   |
| `develop`   | permanent   | `main`        | —                  | Integration branch. Always startable (see below).       |
| `feature/*` | short-lived | `develop`     | `develop`          | New functionality                                       |
| `fix/*`     | short-lived | `develop`     | `develop`          | Bug fixes that are not urgent                           |
| `docs/*`    | short-lived | `develop`     | `develop`          | Documentation-only changes                              |
| `chore/*`   | short-lived | `develop`     | `develop`          | Tooling, deps, config, CI                               |
| `release/*` | short-lived | `develop`     | `main` + `develop` | Version bump, changelog finalization, release hardening |
| `hotfix/*`  | short-lived | `main`        | `main` + `develop` | Urgent production fix                                   |

```
main     ──●───────────────────────●──────────────●──  tags: v0.1.0, v0.1.1, v0.2.0
            \                     /              /
release      \              ●────●              /      release/0.2.0
              \            /                   /
develop  ──────●──●──●────●───────●──●──●─────●─────
                  /        \         /  /
feature          ●          └─ back-merge

```

**There is no staging environment.** This table used to promise `develop` was "always deployable
to staging", and no such deployment has ever existed — there is no host, no workflow and no
secret anywhere in this repository that points at one (audit finding OPS-08). A standing claim
that nothing enforces is worse than no claim, so here is the one that is actually checked:
`develop` must **start**, and the check is a command anyone can run on their own machine.

```bash
docker compose up -d --build
docker compose ps -a                              # every service up; migrate Exited (0)
curl -s http://localhost/api/health/ready         # {"status":"ok","checks":{…}}
```

That is the same stack a self-hoster runs ([Self-hosting](self-hosting.md)) with `SITE_URL` left
at its `http://localhost` default, so "it starts" is verified against the real deployment shape
rather than a staging-only approximation. CI does not run it — the pipeline builds, lints, types
and tests, and a full compose boot on every pull request would cost more than it catches — which
makes this a release-time step, and it is [step 4 of the release process](#release-process).

**No direct commits to `main` or `develop`.** All work reaches them through a branch and a
pull request. This holds for maintainers too.

`main` is releases only: if a commit is on `main` and is not a merge from `release/*` or
`hotfix/*`, something went wrong.

Branch protection on `main` and `develop` enforces this: no direct pushes, pull requests
required. Required status checks are enforced by [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### Dependabot and `main`

Dependabot must open against `develop`, never `main`. Both ecosystems in
[`.github/dependabot.yml`](../.github/dependabot.yml) set `target-branch: develop` for that
reason. Merging dependency bumps straight into `main` (as happened in [#82](https://github.com/dravcore/kurul/pull/82))
bypasses Git Flow and leaves `develop` behind on CI config — do not repeat it. If a
Dependabot PR somehow targets `main`, retarget it to `develop` before merge.

## Branch naming

Format: `type/kebab-short-description`

- `type` is one of `feature`, `fix`, `docs`, `chore`, `release`, `hotfix`
- Description is lowercase kebab-case, 2–5 words, describing the **change**, not a phase
  number, ticket alias, or your name
- `release/*` and `hotfix/*` carry the version instead of a description: `release/0.2.0`

| Good                          | Bad                | Why                                          |
| ----------------------------- | ------------------ | -------------------------------------------- |
| `feature/board-drag-and-drop` | `feature/phase3`   | Phase numbers say nothing about the change   |
| `fix/task-position-collision` | `fix/bug`          | Not identifiable in a branch list            |
| `docs/api-conventions`        | `docs/update-docs` | Redundant, no information                    |
| `chore/bump-prisma-7`         | `dogan-work`       | No type prefix, not scannable                |
| `release/0.2.0`               | `release/v0.2.0`   | The `v` prefix belongs to tags, not branches |

Commit types and branch types share the same vocabulary deliberately — a `feat:`-heavy
branch is a `feature/*` branch.

## Conventional Commits

All commit messages are written in **English** and follow
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <subject>

<body — optional, wrapped at 72–80 chars, explains WHY>

<footer — optional: BREAKING CHANGE:, Closes #123>
```

### Types

| Type       | Use for                                                 | SemVer effect (post-1.0) |
| ---------- | ------------------------------------------------------- | ------------------------ |
| `feat`     | A new user-visible capability                           | MINOR                    |
| `fix`      | A bug fix                                               | PATCH                    |
| `docs`     | Documentation only                                      | none                     |
| `chore`    | Tooling, deps, config, repo housekeeping                | none                     |
| `refactor` | Code change that neither fixes a bug nor adds a feature | none                     |
| `test`     | Adding or correcting tests                              | none                     |
| `ci`       | CI/CD pipeline and workflow changes                     | none                     |
| `perf`     | Performance improvement without behavior change         | PATCH                    |

A commit with a `BREAKING CHANGE:` footer (or `type!:`) is MAJOR post-1.0. See
[Versioning policy](#versioning-policy-semver) for what this means before 1.0.

### Scopes

Scope is optional but strongly preferred. It names the part of the monorepo affected.

| Scope         | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `api`         | `apps/api` — NestJS backend                                  |
| `web`         | `apps/web` — Next.js frontend                                |
| `shared`      | `packages/shared-types`                                      |
| `auth-access` | `packages/auth-access` — Better Auth organization AC roles   |
| `deps`        | Dependency bumps                                             |
| `docs`        | The `docs/` set (when the commit type is not already `docs`) |
| `ci`          | Workflows and pipeline config                                |

Narrower module scopes are fine when they add clarity: `feat(api/task)`, `fix(web/board)`.

### Subject line

- Imperative mood: "add", not "added" or "adds"
- No trailing period, lowercase after the colon
- Under 72 characters

### Examples

```
feat(api): add cursor pagination to task list endpoint

fix(web): keep card order stable when two users drag simultaneously

Positions were recalculated from the stale local list, so a concurrent
move produced two identical Float positions. The move mutation now sends
the neighbour ids and lets the server compute the midpoint.

Closes #142

docs: document the release process in git-strategy

chore(deps): bump prisma to 7.2.1

feat(api)!: scope board endpoints under /workspaces/:workspaceId

BREAKING CHANGE: /boards/:id is removed. Clients must use
/workspaces/:workspaceId/boards/:id.
```

**Write bodies for non-obvious commits.** A subject line says what changed; the body says
why it was wrong before. Commits are read months later by people without the context.

## Pull request process

1. Branch from an up-to-date `develop`.
2. Open the PR **against `develop`** (never against `main`, except `hotfix/*` and
   `release/*`).
3. PR title follows Conventional Commits. Prefer a merge commit (`--no-ff`) so the
   individual commits on the branch stay in history; keep them clean before opening the PR.
   Squash into `develop` is allowed when the branch is noise (Dependabot, single-commit
   chore). Squash into `main` is never allowed — see Merge strategy below.
4. Keep PRs small and single-responsibility: one concern, ideally under ~500 changed lines
   excluding lockfiles and generated output. Split schema changes from logic changes, and
   backend from frontend, where possible.
5. Link the issue the PR resolves (`Closes #123`).
6. CI must be green: lint, typecheck, tests (see [testing.md](testing.md)).
7. At least one approving review before merge.

**Solo-maintainer carve-out.** Rule 7 has no one to satisfy while the project has a single
maintainer, so it is suspended for maintainer-authored PRs: those are self-reviewed and
self-merged once CI is green. Everything else still applies — the branch, the PR, the
Conventional Commits title, the green pipeline. Contributor PRs are reviewed by the
maintainer as normal. **The one-approving-review rule activates the moment a second
maintainer exists**, and this paragraph is deleted then.

### Merge strategy

| Merge                                                 | Strategy                                                                            | Reason                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `feature/*`, `fix/*`, `docs/*`, `chore/*` → `develop` | **Merge commit** preferred; **squash allowed** for Dependabot / single-commit noise | Keeps reviewable multi-commit history when it matters; squash collapses bot noise |
| `release/*` → `main`                                  | **Merge commit only** (`--no-ff`)                                                   | Preserves the release as a distinct, revertible point in history                  |
| `hotfix/*` → `main`                                   | **Merge commit only** (`--no-ff`)                                                   | Same reason                                                                       |
| `main` → `develop` (back-merge)                       | **Merge commit** (`--no-ff`)                                                        | Carries the release/hotfix commits back without rewriting them                    |

Into `main`, squash and rebase are forbidden. A repository ruleset on `main` restricts
allowed merge methods to merge commit so a release/hotfix cannot be flattened by accident.
Into `develop`, squash is available for Dependabot and other single-commit branches; human
multi-commit work still prefers a merge commit. Clean up fixup noise on the branch
(interactive rebase, or amend) **before** opening the PR.

Delete the branch after merge. GitHub's "delete branch on merge" setting handles this.

## Release process

Releases are cut from `develop` through a `release/*` branch. Versions follow
[SemVer](https://semver.org/) and the changelog follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

```bash
# 1. Branch from develop
git switch develop && git pull
git switch -c release/0.2.0

# 2. Bump the version in every package.json (root, apps/*, packages/*)
#    and finalize CHANGELOG.md: rename [Unreleased] to [0.2.0] - YYYY-MM-DD,
#    add a fresh empty [Unreleased] section on top.
git commit -am "chore(release): 0.2.0"

# 3. Only release-blocking fixes may land on this branch.
#    Everything else keeps going to develop as usual.

# 4. Boot the stack once from this branch, then open a PR:
#    release/0.2.0 -> main. Merge with a merge commit (--no-ff).
#
#    CI never boots anything: it builds, lints, types and tests the code, and
#    none of that would notice a docker-compose.yml or Caddyfile that no longer
#    starts. This is the check behind "always startable" in the branch table,
#    and the last point at which a broken one is still cheap to fix.
docker compose up -d --build
docker compose ps -a                       # -a, or the one-shot migrate row is hidden
curl -s http://localhost/api/health/ready  # {"status":"ok","checks":{…}}
docker compose down -v                     # -v: leave no volume behind for the next run

# 5. Tag the merge commit on main. This is also what publishes the container
#    images (.github/workflows/release-images.yml) — no tag, no images, and
#    `docker compose pull` fails for everyone following docs/self-hosting.md.
#    The same run signs all three images with cosign and generates their SBOMs.
#
#    The first time a given image *name* is pushed to GHCR, the package it
#    creates is PRIVATE by default — independent of the repository's own
#    visibility — and an anonymous `docker compose pull` against it fails
#    with "denied", exactly the symptom in audit finding OPS-01. There is no
#    API for this: flip it to Public by hand, once, in the organization's
#    package settings (org -> Packages -> the new image -> Package settings
#    -> Change visibility) before telling anyone the release is out.
#    `kurul-migrate` needs this on the first release after v0.2.0 — the
#    first one this workflow ever publishes it from — and any image name
#    added later needs it again, once, the same way.
git switch main && git pull
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0

# 6. Wait for the Release images workflow to finish, then publish the GitHub
#    Release for tag v0.2.0, body = the CHANGELOG section for 0.2.0.
#
#    The workflow gets there first and leaves a DRAFT release with the six SBOM
#    assets already attached (3 images × 2 platforms) — so step 6 is normally
#    "fill in the body and hit Publish", not "create a release". Publishing by
#    hand before the workflow finishes is not an error either: it only uploads
#    the assets onto whatever release it finds and never rewrites the body,
#    the title or the draft flag. Waiting is still the better order — the
#    assets are part of what a release is.

# 7. Back-merge main into develop so the version bump and any
#    release-branch fixes are not lost.
git switch develop && git pull
git merge --no-ff main
git push origin develop

# 8. Delete release/0.2.0.
```

| Artifact                  | Format                    | Example                   |
| ------------------------- | ------------------------- | ------------------------- |
| Branch                    | `release/x.y.z`           | `release/0.2.0`           |
| Version in `package.json` | `x.y.z`                   | `0.2.0`                   |
| Git tag                   | `vX.Y.Z`                  | `v0.2.0`                  |
| Changelog heading         | `## [x.y.z] - YYYY-MM-DD` | `## [0.2.0] - 2026-09-14` |

`CHANGELOG.md` is maintained continuously under `[Unreleased]`, not reconstructed from git
log at release time. If a PR is user-visible, it updates the changelog.

### CHANGELOG conflicts on the back-merge

Expect one on every release and every hotfix. `develop` keeps accumulating `[Unreleased]`
entries while the `release/*` branch renames its own `[Unreleased]` to a version heading, so
the two versions of the file diverge at exactly the same lines and `git merge --no-ff main`
conflicts at the top of the file. This is normal, not a sign something went wrong.

The rule that resolves it:

- **`CHANGELOG.md` is finalized only on `release/*` and `hotfix/*` branches.** Renaming
  `[Unreleased]` to `## [x.y.z] - YYYY-MM-DD` happens there and nowhere else.
- **On back-merge, take the release side for the version headings**, then re-add any
  `[Unreleased]` entries that landed on `develop` while the release branch was open,
  underneath a fresh empty `[Unreleased]` at the top. Result: `[Unreleased]` first, the new
  version section below it, older versions below that.
- Nothing is ever deleted in this resolution. If an entry existed on either side before the
  merge, it exists after.

`git config rerere.enabled true` is worth setting once — the resolution is structurally the
same every release, and rerere replays it automatically after the first time.

### Rehearsing the publish path

`release-images.yml` also fires on a pre-release tag (`vX.Y.Z-rc.N`, `-beta.N`, anything after
a hyphen), and that exists for one reason: the workflow publishes images, signs them with
cosign and attaches SBOMs, and none of that is exercised by CI. Cutting a version as the first
run of an unexecuted workflow makes the release itself the test.

So when the publish path has changed — a new action major, a change to the signing or SBOM
steps, a new registry — rehearse it before step 5:

```bash
git tag -a v0.2.0-rc.1 -m "v0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

The rehearsal is a real publish: real images, a real signature, real SBOM assets, and the
`cosign verify` command in [self-hosting.md](self-hosting.md#verifying-what-you-pulled) works
against it. What it deliberately does **not** do is move anything anybody follows —
`{{major}}.{{minor}}` and `latest` are skipped for a pre-release, so an operator who never set
`TAG` is unaffected, and the GitHub Release is created as a draft _and_ marked pre-release.

One thing a rehearsal **cannot** cover, measured on `v0.2.0-rc.3`: `metadata-action` emits only
the bare `{{version}}` tag for a pre-release, so `0.2.0-rc.3` is published and `v0.2.0-rc.3` is
not. The `v`-prefixed tag — the form every pull command in this repository tells an operator to
pin — is therefore exercised only by a real release. The merge job asserts it is present on any
non-pre-release tag, so a regression fails the release rather than shipping a documented command
that 404s; but the assertion itself first runs when you cut the version.

A rehearsal tag is disposable. Delete it and its release when the real version ships; the
images stay in the registry under their exact `-rc` tags and cost nothing but a line in the
package list.

## Hotfix process

For a bug in a released version that cannot wait for the next release.

```bash
git switch main && git pull
git switch -c hotfix/0.2.1
# fix, then bump patch version + add the CHANGELOG entry
git commit -am "fix(api): reject task move across workspaces"
git commit -am "chore(release): 0.2.1"
# PR hotfix/0.2.1 -> main, merge with --no-ff, tag v0.2.1, publish release
# then back-merge main -> develop
```

The back-merge is not optional. A hotfix that never reaches `develop` reappears in the next
release.

## Versioning policy (SemVer)

Kurul follows [Semantic Versioning 2.0.0](https://semver.org/) — with the honest caveat
that SemVer's guarantees are weaker before 1.0.

**Pre-1.0 (`0.y.z`) — where the project is now:**

- The public API (REST endpoints, `@kurul/shared-types`, `@kurul/auth-access`, database schema, env var names)
  is **not stable**. Breaking changes can ship in any `0.y.0`.
- `0.y.0` (MINOR): new features **and** breaking changes.
- `0.0.z` / `0.y.z` (PATCH): bug fixes and non-breaking changes only.
- Every breaking change is documented in `CHANGELOG.md` under `### Changed` or `### Removed`
  with a migration note. "Unstable" means no compatibility promise, not no communication.

**Post-1.0:**

- MAJOR: breaking change to the REST API, shared types, or a migration that cannot be
  applied automatically.
- MINOR: backwards-compatible feature.
- PATCH: backwards-compatible fix.

1.0.0 is cut when the MVP feature set in [ROADMAP.md](../ROADMAP.md) is complete and the REST
API is considered stable enough to promise compatibility.

API versioning stance (no `/v1` prefix before 1.0) is covered in
[api-conventions.md](api-conventions.md#versioning).

## Rules summary

| Rule                                 |                                                        |
| ------------------------------------ | ------------------------------------------------------ |
| Direct commits to `main` / `develop` | Never                                                  |
| PR target branch                     | `develop` (except `release/*` and `hotfix/*` → `main`) |
| Commit language                      | English                                                |
| Commit format                        | Conventional Commits                                   |
| Feature → `develop`                  | Merge commit preferred; squash OK for Dependabot/noise |
| Release/hotfix → `main`              | Merge commit only + back-merge to `develop`            |
| Tag format                           | `vX.Y.Z`                                               |
| Changelog                            | Updated in the PR, not at release time                 |

## See also

- [../CONTRIBUTING.md](../CONTRIBUTING.md) — contributor-facing summary of this process
- [development.md](development.md) — environment setup and the day-to-day loop
- [coding-standards.md](coding-standards.md) — what reviewers check in a PR
- [testing.md](testing.md) — what CI runs on every PR
- [../ROADMAP.md](../ROADMAP.md) — what a release contains
- [decisions/0008-git-flow-semver.md](decisions/0008-git-flow-semver.md) — why Git Flow and
  SemVer were chosen
