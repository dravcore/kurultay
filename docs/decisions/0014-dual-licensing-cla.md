# 0014. Dual Licensing and a Contributor License Agreement

**Status:** Superseded by [0028](0028-open-contributions-hosted-service.md)
**Date:** 2026-08-11

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0014-dual-licensing-cla.md)

> **Superseded:** on 2026-08-21 the commercial-license model and the CLA described below were
> abandoned by [0028](0028-open-contributions-hosted-service.md). Revenue now comes only from a
> hosted service run by Dravcore, and contributions are accepted under plain AGPL-3.0 with no
> agreement to sign. This record is kept as history; nothing in it is in force.

## Context

[ADR 0007](0007-license-agpl.md) chose AGPL-3.0 and left the commercial model open, naming
open core as the likely path and noting that it would "likely" need a CLA. That model now has
to be pinned down, because the choice constrains what every future contribution is allowed to
become.

AGPL-3.0 is what makes any of this possible. A permissive license lets anyone take the code
closed without asking, so there is nothing to sell; AGPL's network-use copyleft creates a real
obligation that an enterprise may genuinely prefer to buy its way out of. The license is the
product's only leverage. But that leverage belongs to the **copyright holder**, and by default
each contributor holds the copyright in their own patch. Under AGPL-3.0 alone, an inbound
contribution arrives licensed to the world under AGPL-3.0 and nothing more — the maintainer
gets exactly the rights everyone else gets. That is enough to keep shipping the open-source
project and not enough to sell anyone an exemption from the AGPL, because the maintainer
cannot grant terms over code he does not control.

The window for fixing this is now. Kurul has one contributor — the maintainer — so
establishing a contribution agreement today costs a pull request. Once external contributions
land without one, the code they touched is permanently AGPL-only unless every one of those
authors can be found and persuaded to relicense, which in practice does not happen. This is a
one-way door in the same sense ADR 0007 described, pointing the other way.

## Decision

**Dual licensing, not open core**, and **a Contributor License Agreement for all external
contributions.**

One codebase, fully AGPL-3.0, with nothing held back — the community sees and runs every
feature. Organizations that cannot accept AGPL's obligations buy a separate commercial license
to that same code from the maintainer.

To make the second half legally possible, every external contributor signs a CLA
(`docs/cla.md` (deleted 2026-08-22, in git history)) granting the maintainer a non-exclusive, worldwide, perpetual,
irrevocable, sublicensable license including the right to distribute the contribution under
**any** license terms, while the contributor keeps copyright and every right to reuse their own
code. The agreement is derived from the **Harmony** Individual CLA (HA-CLA-I, "any license"
outbound option) — the template written for exactly this situation — not from the Apache
Individual CLA, whose outbound grant assumes a single permissive outbound license and does not
carry the relicensing right dual licensing depends on.

Three specifics follow from the maintainer being a natural person and Turkish-resident:

- **Rights are granted to Doğan Can Yıldız as an individual.** No company exists. If one is
  incorporated later, moving the rights to it is a separate transfer transaction, not something
  that happens by itself.
- **The agreement is a license grant, not an assignment.** Dual licensing needs a sublicensable
  license, not ownership, and the license form avoids the stricter formalities that attach
  specifically to transfers of economic rights. Whether it avoids them successfully is a
  question for a lawyer, flagged in the document.
- **The document is a draft.** It ships with a prominent not-in-force banner and unresolved
  `[ASK A LAWYER: …]` markers. Nobody is asked to sign until those are resolved.

Enforcement is a GitHub Actions check (`.github/workflows/cla.yml`, deleted by 0028, last version in git history)
that blocks merge until every commit author has signed by posting a fixed sentence as a PR
comment.

This ADR **complements** ADR 0007 rather than superseding it. 0007's license choice stands
unchanged; 0014 replaces its open-core aside with a settled model.

## Rationale

- **A permissive license would have removed the product.** Under MIT or Apache-2.0 a customer
  never needs a commercial license, because the free license already permits everything the
  paid one would. Dual licensing is only a business when the default terms are ones somebody
  wants out of — which is what AGPL provides and what ADR 0007 already bought.
- **DCO is not a substitute.** A Developer Certificate of Origin is a statement of provenance:
  the contributor certifies they have the right to submit the code under the project's existing
  license. It grants nothing beyond that license. It cannot authorize the maintainer to
  distribute the contribution under different terms, so under a DCO the commercial license
  would have to exclude every external contribution — which is unworkable the moment external
  contributions touch shared code.
- **Dual licensing over open core, given a one-person team.** Open core requires a maintained
  boundary between community and proprietary code: two build targets, two test matrices, and a
  judgment call on every feature about which side it lands on, enforced forever. ADR 0007 named
  that "careful architectural separation" as a cost. For a solo maintainer it is a recurring
  tax on every change, paid before there is any revenue to justify it. Dual licensing costs a
  contribution agreement once, up front, and leaves the architecture alone. It also keeps the
  open-source claim clean: no feature is withheld, so "open source" needs no asterisk.
- **Harmony over a hand-written or Apache-derived agreement.** Harmony was drafted by lawyers
  specifically for projects that intend to distribute contributions under multiple licenses,
  and its Section 2.3 "any license" outbound option is the exact clause the model needs. Its
  Section 2.1(a) — the contributor retains ownership and every pre-existing right — is what
  makes the agreement defensible to sign, and is the sentence to point at when someone objects.
- **A CLA-check bot rather than an honor system.** An unsigned contribution that gets merged is
  not recoverable; the code has to be reverted or rewritten. A required status check makes the
  failure mode "PR waits" instead of "codebase is quietly contaminated".

## Consequences

- **The CLA will cost contributions.** Some developers refuse CLAs on principle, some will not
  read a legal document to fix a typo, and some cannot sign without an employer's approval they
  will not bother to chase. This is a real, permanent tax on drive-by contributions, and it is
  paid in the currency a young project has least of. It is accepted knowingly.
- **The honesty is deliberate and also a cost.** [CONTRIBUTING.md](../../CONTRIBUTING.md) and
  the bot's comment both say plainly that the CLA exists so the maintainer can sell the code
  under a commercial license. A vaguer wording would lose fewer contributors in the short term
  and more trust when someone works it out.
- **Revenue is not guaranteed by any of this.** Dual licensing converts only where AGPL
  compliance is genuinely feared — regulated enterprises, companies embedding the product in
  something they ship, organizations with a legal department that maintains a license
  blocklist. Small companies and internal deployments overwhelmingly do not care, and self-
  hosting an AGPL tool internally triggers no obligation at all. The CLA makes revenue
  _possible_, not _likely_; the model can be executed perfectly and still earn nothing.
- **The first unsigned external contribution is unrecoverable.** If a PR merges before the
  check is live, that code is AGPL-only. Removing it later means reverting or rewriting it from
  scratch, and shipping the commercial license with it in place would be a licensing breach.
  This is why the mechanism goes in before the first outside PR rather than after.
- **The legal work is not done.** The document is a draft with open questions — who "Us" is
  once a company exists, whether a PR comment is a valid signature, whether FSEK's form
  requirements reach a license grant, which law governs. Those are listed in
  `docs/cla.md` (deleted 2026-08-22, in git history) and had to be answered before the CLA binds
  anyone. Until then the check is scaffolding, not enforcement.
- **A corporate contributor has no path yet.** There is no Entity CLA. A company that wants to
  contribute has to wait for one, or its employee signs individually with employer approval,
  which is thinner cover than a corporate agreement.
- **The signature ledger becomes part of the repository's history.** Signatures live in
  `signatures/v0.1/cla.json` on a dedicated `cla-signatures` orphan branch — chosen over a
  private remote repository because a public record is auditable by the contributors it binds
  and by anyone evaluating the project's license position, and because it needs no personal
  access token secret with repo-wide scope. Its own branch keeps bot commits out of `develop`
  and `main`, which Git Flow forbids writing to directly. The cost is that the ledger can only
  hold what is already public on the pull request: a GitHub username and id, never an email
  address. If legal review requires more identifying data in the record, that decision forces a
  move to a private repository and a personal access token.
- **The CLA-check tooling is unmaintained.** `contributor-assistant/github-action` was archived
  in March 2026. It is pinned to the v2.6.1 commit SHA, so an abandoned repository cannot change
  underneath us, and the action is self-contained enough to keep working — but it will receive
  no fixes, and it will eventually break when GitHub retires the node20 action runtime. The
  alternatives are worse today: the hosted cla-assistant.io service puts signatures on someone
  else's infrastructure behind an OAuth app, and the existing forks have no adoption. Migration
  is a known future chore, not a surprise.
- **Every contributor grants a patent license too.** Section 2.2 of the CLA is broader than the
  copyright grant most contributors expect from an open-source project. It is standard for CLAs
  and still a reason some will decline.

## Alternatives considered

| Alternative                                                   | Why not                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open core (AGPL core + proprietary add-ons)                   | The path ADR 0007 anticipated. Needs a permanent architectural boundary and a per-feature decision about which side it falls on — a recurring cost a solo maintainer pays on every change, before any revenue exists. Also weakens the open-source claim: some features are withheld |
| DCO instead of a CLA                                          | Certifies provenance only. Grants no relicensing right, so contributed code could never appear in a commercially licensed build — the commercial edition would have to exclude every external contribution                                                                           |
| Permissive license (MIT / Apache-2.0)                         | Nothing left to sell: the free license already permits closed-source use and resale, so no customer needs a commercial one. Also reopens the SaaS-resale hole ADR 0007 closed                                                                                                        |
| BSL / source-available (Sentry, HashiCorp-style)              | Removes the CLA problem by removing open source: not an OSI-approved license, so it forecloses the contribution model and the community distribution that the AGPL choice was made to enable                                                                                         |
| Copyright assignment (Harmony CAA) instead of a license grant | Gives the maintainer the strongest position, but takes ownership away from contributors — a much harder ask — and triggers the stricter formal requirements that apply to transfers of economic rights. A sublicensable license is sufficient for dual licensing                     |
| No CLA, decide later                                          | The cheapest option today and the most expensive later: contributions merged without one are permanently AGPL-only, and unwinding them means locating and persuading every past author                                                                                               |
