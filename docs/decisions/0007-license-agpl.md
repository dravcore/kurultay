# 0007. License: AGPL-3.0

**Status:** Accepted
**Date:** 2026-08-08

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0007-license-agpl.md)

> **Follow-up:** the commercial model left open below is settled in
> [0028](0028-open-contributions-hosted-service.md): AGPL-3.0 stays, and the business is an
> optional hosted service run by Dravcore rather than dual licensing (which 0014 proposed and
> 0028 abandoned). 0028 complements this record; it does not supersede it.

## Context

Kurul is an open-source project management tool that could plausibly be
taken by a third party and resold as closed-source SaaS without any
obligation to contribute back. The license must prevent that outcome while
leaving a realistic path to a sustainable business model for the maintainers.

## Decision

**AGPL-3.0**.

## Rationale

- AGPL-3.0 closes the network-use loophole that plain GPL leaves open: running
  modified code as a network service isn't "distribution" under GPL, so GPL
  alone doesn't force a SaaS operator to release their changes. AGPL's
  network-use clause does.
- Precedent: Plane, the most popular OSS project-management tool, also chose
  AGPL-3.0.
- AGPL keeps an open-core path available — an AGPL community edition alongside
  separately licensed enterprise features — without foreclosing that model.
- Relicensing or relaxing AGPL later requires consent from every contributor
  whose code remains in the codebase. That makes it effectively a one-way
  door, so it has to be right from day one rather than "fixed" later.

## Consequences

- Closed-source resale of Kurul by competitors or cloud providers is not
  permitted without releasing their modifications.
- The open-core path (AGPL core + proprietary enterprise add-ons) stays open
  for the future if that business model is pursued.
- AGPL's copyleft strength can deter some enterprise adopters and contributors
  who are wary of its network-use clause — a real cost weighed against the
  protection it provides.
- Combining AGPL community code with any future proprietary enterprise
  features requires careful architectural separation (and likely a CLA) to
  avoid tainting the proprietary code.
- Changing course later requires tracking down and getting sign-off from every
  past contributor — in practice, close to impossible once the contributor
  base grows.

## Alternatives considered

| Alternative                                | Why not                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| MIT / Apache-2.0 (permissive)              | Allows closed-source SaaS resale with no obligation to contribute back — undermines the open-source sustainability goal |
| Plain GPL-3.0                              | Leaves the network-use/SaaS loophole open — a hosted fork wouldn't have to release its source                           |
| Proprietary / source-available (e.g., BSL) | Forecloses a genuine open-source community contribution model from day one                                              |
