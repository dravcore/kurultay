# 0028. Open Contributions Under AGPL-3.0, No CLA; Revenue Only From a Hosted Service

**Status:** Accepted (supersedes [0014](0014-dual-licensing-cla.md) and
[0015](0015-no-external-contributions.md))
**Date:** 2026-08-21

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0028-open-contributions-hosted-service.md)

> **Updated (2026-08-22):** `docs/archive/` was removed in full, the CLA draft with it. The
> consequence below that moves `docs/cla.md` to `docs/archive/cla-draft.md` was carried out and
> then overtaken a day later; the draft now exists only in git history.

## Context

[ADR 0007](0007-license-agpl.md) chose AGPL-3.0. [ADR 0014](0014-dual-licensing-cla.md) built a
business model on top of it: the same code sold to organizations under a commercial license, which
requires the maintainer to hold relicensing rights over every line, which in turn requires every
outside contributor to sign a Contributor License Agreement. [ADR 0015](0015-no-external-contributions.md)
then recorded that the CLA could not be enacted without a lawyer's review (FSEK's written-form
requirement for a Turkish-resident maintainer), that no such review was planned, and that outside
code, documentation and translation pull requests would therefore not be merged at all, with no end
date.

The effect, over the months since, has been simple: nobody could help. Bug fixes, translations and
small improvements that people were willing to contribute were turned away at the door, and the
project ran as a single-author codebase to protect a revenue stream that never existed. Not one
commercial license was sold, none was requested, and the legal work that would have made a sale
possible was never commissioned. The cost of the closed door was real and paid daily; the benefit it
protected was hypothetical.

Meanwhile the shape of a viable business became clearer. The people who would pay for Kurul are not
the enterprises that want an AGPL exemption; they are the teams that want a board without running a
server. That is a hosting business, and a hosting business does not need concentrated copyright.

## Decision

1. **AGPL-3.0 stays.** [ADR 0007](0007-license-agpl.md) stands unchanged. The license is still what
   stops a third party from taking the code closed and reselling it as a service.

2. **Dual licensing and the CLA are abandoned.** No commercial license is offered or sold, now or
   later. The CLA draft is archived, the disabled `CLA` workflow is deleted, the `licensing@` line
   is removed from every README, and no signature, agreement or employer approval is asked of any
   contributor.

3. **External contributions are accepted.** Code, documentation and translation pull requests are
   welcome again. The license terms are inbound = outbound: by submitting a contribution you license
   it under the project's AGPL-3.0, the same terms every user already has, and you keep your
   copyright. This is the GitHub default (Terms of Service, section D.6) and needs no paperwork.
   Issue-first for non-trivial work, the ~500-line PR guideline and review before merge (the maintainer
   self-reviews their own PRs while there is a single maintainer) all remain.

4. **Revenue comes from one place: a hosted service run by Dravcore.** An account on our servers,
   free within a published set of limits, paid above them. Limits are operational quantities (seats,
   boards, storage, similar), not features.

5. **Self-hosting is free, forever, with nothing held back.** Nobody who runs Kurul on their own
   server is asked for money, and no product is sold separately from the hosted service. There is no
   open core: the hosted service runs the same AGPL code that is in this repository, including the
   plan-limit and billing code it needs. A self-hoster sets those limits to whatever they want, or
   leaves them off.

This ADR supersedes 0014 and 0015 in full. It complements 0007.

## Rationale

- **The door was costing more than it protected.** ADR 0014 accepted "a real, permanent tax on
  drive-by contributions" as the price of keeping a commercial license possible. Two releases later
  the tax had been paid in full and the license had earned nothing. Reversing the trade is the
  obvious correction once the revenue model no longer depends on it.
- **A hosted service needs no relicensing right.** Selling an AGPL exemption requires owning the
  right to relicense every contribution; that is the whole reason 0014 needed a CLA. Charging for
  an account on a server you operate requires nothing of the sort. Anyone can run the same code;
  what the customer buys is that they do not have to. Once that is the business, the CLA has no job
  left, and the legal question ADR 0015 was stuck on (whether a PR comment satisfies FSEK's form
  requirement) no longer needs an answer.
- **AGPL is still the right license for this model.** A permissive license would let a competitor
  host Kurul with private improvements and undercut the service. AGPL's network-use clause obliges
  anyone who hosts a modified Kurul to publish their modifications, which keeps the playing field
  level and keeps improvements flowing back. ADR 0007's reasoning is intact; only the thing it
  protects has changed from "a license to sell" to "a service to run".
- **Inbound = outbound instead of a DCO, for now.** A Developer Certificate of Origin adds a
  `Signed-off-by` trailer and a bot, and certifies provenance only. ADR 0014 rejected it because it
  grants no relicensing right, which was the point then and is irrelevant now. It is not adopted
  today because the friction is not yet justified for a project this size; it can be added later
  with a CONTRIBUTING paragraph and a CI check, without touching any past contribution.
- **Limits, not features, because open core was rejected for good reasons.** ADR 0007 and 0014
  both named the recurring cost of a community/proprietary boundary and the asterisk it puts on
  "open source". Metering an operational quantity needs no boundary: the same code enforces a
  configurable ceiling, and the hosted instance simply configures it.

## Consequences

- **The relicensing door is closed permanently, and that is accepted.** From the first merged
  outside contribution onward, the codebase is AGPL-3.0 for everyone including the maintainer.
  Offering a commercial license later would require agreement from every past author, which in
  practice means it will never be offered. ADR 0014 called this a one-way door; this ADR walks
  through it on purpose.
- **Anyone may host Kurul commercially, including competitors.** AGPL obliges them to publish their
  changes, not to stay away. The durable advantages of the official service are operation, support,
  trust and the name. Registering the Kurul name as a trademark becomes a real follow-up rather
  than a someday item.
- **The product has to grow a plan-limit layer.** Seats, boards and storage per workspace (and per
  instance) need a single, configurable enforcement point in the open codebase, extending the
  pattern [ADR 0027](0027-attachment-quotas.md) already set for attachment bytes: soft ceilings read
  from configuration, unlimited when unset, a `413`-style refusal with a clear error code when
  exceeded. Billing integration and plan assignment are part of the same open code, switched on
  only by configuration the hosted instance sets. Scope and sequencing live in
  [ROADMAP.md](../../ROADMAP.md).
- **Reviewing outside work is now real maintainer time.** CONTRIBUTING.md, the PR template and
  `docs/coding-standards.md` become the contract a stranger reads before opening a PR, so they have
  to be precise about what gets merged. CI must stay safe on pull requests from forks: secrets are
  not exposed to fork workflows, and anything that needs them runs after merge.
- **Three documents change meaning at once.** CONTRIBUTING.md and both READMEs drop the
  no-contributions and commercial-license language; `docs/cla.md` moves to `docs/archive/cla-draft.md`
  with its not-in-force banner intact as a historical record; `.github/workflows/cla.yml` is deleted
  (its last version is in git history if a DCO check is ever modelled on it); ADR 0014 and 0015
  get `Superseded by 0028` status lines. ADR 0007 gets a follow-up note pointing here instead of
  to 0014.
- **Trust is a two-way cost.** Announcing "you can contribute now" after months of "you cannot"
  needs no apology but does need consistency: if the door opens, review has to actually happen at a
  reasonable pace, or the reversal costs more goodwill than the original pause did.

## Alternatives considered

| Alternative                                     | Why not                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep 0014 and 0015 as they are                  | No contributions, no revenue, and an open legal question nobody intends to answer. The status quo was the problem                                                                                            |
| Commission the legal review and enact the CLA   | Pays for a lawyer to unlock a commercial-license business that has had zero demand, and keeps the contribution tax 0014 itself called permanent. Solves the wrong problem                                    |
| Open core: hosted-only proprietary features     | Rejected in 0007 and 0014 for the maintenance boundary and the asterisk on "open source"; both objections still hold. Limits on operational quantities achieve the pricing without a second codebase         |
| Source-available license (BSL, SSPL, Fair-code) | Would prevent competitors from hosting Kurul, but ends the open-source claim, forecloses packaging by distributions and alienates exactly the contributors this decision is trying to welcome                |
| DCO with a bot from day one                     | Reasonable and cheap, but not free: a trailer every contributor forgets and a check that blocks their first PR. Deferred until contribution volume justifies it; adding it later costs nothing retroactively |
| Permissive license (MIT / Apache-2.0)           | Would let a competitor host a closed fork of Kurul with private improvements, which is the one thing a hosting business cannot afford. ADR 0007's SaaS-resale argument applies with more force now, not less |
