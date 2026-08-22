# Contributing to Kurul

How to propose, build, and submit changes.

Kurul is AGPL-3.0 (see [LICENSE](LICENSE)) and it is open to contributions: code, documentation
and translations are all welcome, as are bug reports, feature ideas and design feedback. The
project refused outside pull requests until 2026-08-21; that was reversed in
[ADR 0028](docs/decisions/0028-open-contributions-hosted-service.md), which records the history
and the reasoning.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Read it before
opening an issue or PR.

## License of contributions

**Inbound equals outbound.** By opening a pull request you license your contribution under
AGPL-3.0: the terms the rest of the codebase already carries, and the same terms every user
already has. Nothing broader is asked of you.

**You keep your copyright.** The project takes no ownership of your work and cannot relicense
it. It stays yours; what you grant is the project's own license, nothing more.

**There is no CLA and no DCO.** Nothing to sign, no bot commenting on your pull request, no
employer approval form. A `Signed-off-by` requirement may be adopted later if the project grows
into needing one; it would be written into this file before it applied to anyone, and it would
never reach back to work already merged.

**What you confirm by opening a PR** is that you have the right to submit the work: you wrote
it, or whoever owns it (an employer, an upstream project) allows you to contribute it under
AGPL-3.0. If you are working on company time or company equipment and are not certain, say so
on the pull request before it is reviewed.

## Ways to contribute

| Type             | How                                                                        |
| ---------------- | -------------------------------------------------------------------------- |
| Bug report       | [Open a bug report issue](.github/ISSUE_TEMPLATE/bug_report.yml)           |
| Feature idea     | [Open a feature request issue](.github/ISSUE_TEMPLATE/feature_request.yml) |
| Design feedback  | Comment on an issue, or open a discussion                                  |
| Code             | Find or open an issue first, then a PR against `develop`                   |
| Docs             | Same, and update the `docs/tr/` mirror in the same PR                      |
| Translation      | Same; the locale catalogs stay key-for-key with English                    |
| Typo / dead link | A one-line PR is fine, no issue needed                                     |

English is canonical. A PR that changes a file under `docs/` updates its Turkish mirror under
`docs/tr/` in the same PR, and a change to `README.md` updates `README.tr.md`. If you can write
only one of the two, say so on the issue rather than leaving the mirror to drift silently.

## Issue-first rule

Propose before you implement. Open or find an issue and get it acknowledged before
starting non-trivial work — this avoids duplicate effort and wasted review time on changes
that won't be accepted. Trivial fixes (typos, broken links) can skip straight to a PR.

## Development setup

Clone, install, and run the monorepo (`apps/api`, `apps/web`, Postgres, Redis) using
[docs/development.md](docs/development.md) — start there for environment variables,
Compose, migrations, and the day-to-day loop. Quick start is also in the root
[README.md](README.md).

## Branching and commits

- Branch off `develop`, named `<type>/<short-description>` (e.g. `feature/board-dnd`,
  `fix/task-position-rounding`)
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, ...), in English

Full branch model (Git Flow: `main` / `develop` / `feature/*` / `fix/*` / `docs/*` /
`chore/*` / `release/*` / `hotfix/*`) and commit conventions:
[docs/git-strategy.md](docs/git-strategy.md).

## Coding guidelines

Conventions for TypeScript/NestJS/Next.js code: [docs/coding-standards.md](docs/coding-standards.md).
Test expectations: [docs/testing.md](docs/testing.md).

## Making a pull request

- **Target `develop`** (except `release/*` / `hotfix/*`, which follow
  [docs/git-strategy.md](docs/git-strategy.md)).
- **Keep PRs small and focused.** Aim for under 500 lines changed and a single
  responsibility per PR (excluding docs/lockfiles). Split schema changes from logic
  changes, and frontend from backend, where possible.
- Link the issue the PR addresses.
- Fill in the PR template checklist (conventional title, docs updated where relevant,
  lint/typecheck/tests — CI must be green).
- CI on a pull request from a fork runs without repository secrets, so a job that needs one
  runs after merge instead. If a check is skipped on your PR, that is why.
- Expect **one approving review** before merge. Prefer a merge commit into `develop`
  (`--no-ff`) so multi-commit history stays readable; squash into `develop` is allowed for
  Dependabot / single-commit noise. Squash into `main` is never allowed — see
  [docs/git-strategy.md](docs/git-strategy.md#merge-strategy).
  While Kurul has a single maintainer there is nobody to review _their_ PRs, so
  maintainer-authored PRs are self-reviewed and self-merged once CI is green. Your PRs are
  reviewed as normal, and the review requirement applies to everyone again as soon as a
  second maintainer exists.
- Clean up noisy fixup commits (interactive rebase or amend) before requesting review — they
  land in `develop` as-is.

## Need help?

Open a [GitHub Discussion](https://github.com/dravcore/kurul/discussions) or comment on
the relevant issue.
