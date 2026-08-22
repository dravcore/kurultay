# Documentation

Five-minute map of Kurul docs. English is canonical; Turkish copies live under
[`tr/`](tr/README.md).

> 🌐 English (canonical) · Turkish: start at [`../README.tr.md`](../README.tr.md) and
> [`tr/README.md`](tr/README.md)

## Start here

| If you want…                      | Read                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| What the product is / quick start | [../README.md](../README.md)                                                          |
| How the system is shaped          | [architecture.md](architecture.md) · [design.md](design.md)                           |
| Day-to-day coding                 | [development.md](development.md) · [coding-standards.md](coding-standards.md)         |
| Running it on your own domain     | [self-hosting.md](self-hosting.md)                                                    |
| REST shapes and errors            | [api-conventions.md](api-conventions.md)                                              |
| The generated API specification   | [`apps/api/openapi.json`](../apps/api/openapi.json), or `/docs` on a running instance |
| Tests and CI gates                | [testing.md](testing.md)                                                              |
| Branches, PRs, releases           | [git-strategy.md](git-strategy.md)                                                    |
| Why a stack or policy choice      | [tech-stack.md](tech-stack.md) · [decisions/](decisions/)                             |
| What’s done / what’s deferred     | [../ROADMAP.md](../ROADMAP.md)                                                        |

Root community files (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, …)
sit outside `docs/` because GitHub treats them specially.

## Language policy

- **English is canonical** for behavior, architecture, and process.
- Turkish lives under `docs/tr/` with the same filenames; root uses `README.tr.md`.
- When EN and TR disagree, fix EN first, then sync TR. TR may lag; banners can say so.

## Active docs

| Doc                                        | Covers                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)         | Module map, data model, runtime evolution                                                         |
| [tech-stack.md](tech-stack.md)             | Stack choices and rationale (pins: see root / app `package.json`)                                 |
| [development.md](development.md)           | Env setup, Compose, pnpm scripts, day-to-day, upgrade & rollback                                  |
| [self-hosting.md](self-hosting.md)         | Deploying a release to your own domain: DNS, HTTPS via Caddy, SMTP, backups, bring-your-own proxy |
| [coding-standards.md](coding-standards.md) | TS / NestJS / Next.js conventions                                                                 |
| [design.md](design.md)                     | UI/UX language                                                                                    |
| [git-strategy.md](git-strategy.md)         | Git Flow, Conventional Commits, releases                                                          |
| [testing.md](testing.md)                   | Test layers and expectations                                                                      |
| [api-conventions.md](api-conventions.md)   | REST naming, errors, pagination, and where the generated OpenAPI document lives                   |
| [../ROADMAP.md](../ROADMAP.md)             | Roadmap: hardening + feature tracks, beyond-MVP backlog                                           |
| [decisions/](decisions/)                   | Architecture decision records (ADRs)                                                              |

New feature design after MVP opens as a **GitHub Issue** (and an ADR when a lasting decision
is needed). Do not grow a parallel `docs/specs/` tree for routine work.
