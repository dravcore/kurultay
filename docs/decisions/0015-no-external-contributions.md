# 0015. No External Contributions; Legal Spend Deferred

**Status:** Superseded by [0028](0028-open-contributions-hosted-service.md)
**Date:** 2026-08-12

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0015-no-external-contributions.md)

> **Superseded:** contributions were reopened on 2026-08-21 by
> [0028](0028-open-contributions-hosted-service.md). Code, documentation and translation pull
> requests are accepted again under plain AGPL-3.0, with no CLA and nothing to sign. The FSEK
> question below no longer needs an answer, because nothing is relicensed any more. This record
> is kept as history; nothing in it is in force.

## Context

[ADR 0014](0014-dual-licensing-cla.md) settled the business model — dual licensing, with a
Contributor License Agreement making it legally possible — and shipped
`docs/cla.md` (deleted 2026-08-22, in git history) as a Harmony-derived draft plus a merge-blocking GitHub Actions
check. It also recorded, honestly, that the legal work was not finished: the document carries
unresolved `[FILL: …]` and `[ASK A LAWYER: …]` markers and a prominent not-in-force banner.

The hardest of those open questions is not cosmetic. The maintainer is a natural person
resident in Turkey, so FSEK (Law No. 5846) governs, and FSEK requires agreements over economic
rights in a work to be **in writing**. Whether a GitHub pull-request comment satisfies that
form requirement — and whether the requirement reaches a sublicensable license grant at all,
or only an outright transfer — is not something that can be reasoned out from documentation.
It needs a lawyer, and the answer decides whether every signature already collected is worth
anything.

The maintainer is not going to have that conversation now, and has no date in mind for it.
That leaves the CLA permanently un-actionable in the near term, and leaves a live CLA check
demanding signatures against a draft. A decision that assumed the review would land shortly is
no longer describing reality, so the reality has to be written down instead.

## Decision

**Kurul does not accept external contributions.** No outside code, documentation, or
translation pull request is merged. The codebase stays single-authored: the maintainer writes
it, and copyright in all of it stays in one pair of hands — the model [SQLite](https://www.sqlite.org/copyright.html)
has run on for decades. Bug reports, feature ideas, design feedback and discussion are wanted
as much as ever; a one-line typo or dead-link fix still carries no copyright worth arguing
about and is still welcome.

**The CLA draft is kept, not enacted.** `docs/cla.md` (deleted 2026-08-22, in git history) stays in the repository with
its not-in-force banner intact, and the CLA workflow
(`.github/workflows/cla.yml`, deleted by 0028, last version in git history) is disabled — triggers cut
back to `workflow_dispatch` and the job guarded with `if: ${{ false }}` — rather than deleted.
The work is done and waiting; if the legal review ever happens, enabling it is a small change,
not a rewrite.

**Legal spend is deferred to the first commercial sale.** The lawyer this project actually
needs is not one for the CLA but one for the commercial license agreement, and that document
is only needed when there is a paying customer to sign it. At that point the revenue justifies
the fee, and the customer's own counsel reviews the text as well — two readings for one
expense.

This ADR does **not** supersede [ADR 0014](0014-dual-licensing-cla.md). 0014's target model —
one AGPL-3.0 codebase, sold in parallel under a commercial license, with a CLA covering any
external contribution — remains the intended destination. 0015 suspends the route to it: the
CLA half is dormant until legal review happens, and the contribution half is closed in the
meantime so that nothing accumulates that would need a CLA retroactively.

## Rationale

- **100% copyright ownership closes no doors.** As the sole author, the maintainer can dual
  license, sell a commercial license, relicense, or close the source entirely — every option
  ADR 0014 wanted, and several it did not, all available without asking anyone. The CLA exists
  only to buy back that freedom after it has been given away in pieces. Not giving it away in
  the first place is strictly simpler.
- **The CLA solves a problem the project does not have yet.** It is machinery for handling
  external contributions, and there are zero external contributors. Standing up unreviewed
  legal machinery to govern traffic that does not exist is risk without benefit: the risk is
  real (invalid signatures), the benefit is hypothetical (a contributor who has not appeared).
- **Collecting invalid signatures is worse than collecting none.** A signature that fails
  FSEK's form requirement does not announce itself. It sits in the ledger looking like
  coverage, and the defect surfaces at the worst possible moment — during a commercial
  customer's due diligence, when the code has already shipped under terms the maintainer
  may not have had the right to grant. Zero signatures is an obvious, honest gap that can be
  planned around. A drawer of unenforceable ones is a hidden liability.
- **A live check against a draft is disrespectful, not just untidy.** Someone who opens a code
  pull request today is asked by a bot to sign an unreviewed legal document in order to unblock
  a pull request that will not be merged regardless. The honest move is to refuse the
  contribution up front and turn the bot off.
- **Deferral is the cheapest correct order of operations.** Paying for a CLA review now buys
  the right to accept contributions that nobody is offering. Paying for a commercial license
  review at the first sale buys a document that produces revenue on the day it is signed.

## Consequences

- **No code community forms.** This gives up one of open source's largest advantages —
  outside eyes, outside patches, outside maintenance — and it is the biggest cost of this
  decision, taken deliberately rather than reluctantly. The code is still open, readable,
  forkable and self-hostable under AGPL-3.0; what is closed is the inbound path.
- **The single developer is the bottleneck.** If the project grows, throughput is capped at
  one person's time, and there is no mechanism to relieve it. A backlog cannot be delegated,
  and a bus factor of one is not mitigated by anything.
- **People who want to help will be turned away, and some will take it personally.** A refused
  pull request reads as rejection no matter how carefully the reasoning is written, and some
  contributors will conclude the project is not really open source. [CONTRIBUTING.md](../../CONTRIBUTING.md)
  states the position plainly and in advance so that nobody discovers it after doing the work,
  which is the most that can be done about it.
- **The pause has no end date.** ADR 0014 was written expecting the CLA to come into force;
  this one deliberately promises no timeline, because a promised date that slips is worse than
  an honest "indefinite".
- **The decision is reversible, and reversing it brings the problem straight back.** Reopening
  contributions requires the CLA to be in force first, which requires the legal review this ADR
  defers — the FSEK question does not get easier or cheaper with time. Nothing here is a
  one-way door, but the door only opens in the order 0014 described.
- **Documentation stays single-language-canonical by necessity, not just by convention.** With
  translation contributions closed, the Turkish mirror under `docs/tr/` remains the
  maintainer's own work to keep in sync.
- **The dormant CLA machinery needs occasional upkeep.** `contributor-assistant/github-action`
  is archived (ADR 0014) and will eventually stop working on GitHub's runners. Because the
  workflow is disabled rather than deleted, that decay is silent until someone tries to
  re-enable it.

## Alternatives considered

| Alternative                                             | Why not                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enact the CLA without legal review                      | Signatures could fail FSEK's written-form requirement and be worthless, with the defect surfacing during a commercial customer's due diligence — after the code has shipped. An invisible defect is worse than a visible gap                                    |
| Drop dual licensing; accept contributions as plain AGPL | No CLA needed and the community path stays open, but the commercial model closes: contributed code could never appear in a commercially licensed build, and ADR 0007's leverage becomes unsellable. The maintainer is not willing to give up the business model |
| Talk to a lawyer now                                    | The correct fix, and it stays the plan — deferred, not rejected. Today it is an expense with no revenue behind it, to license contributions that nobody has offered                                                                                             |
| Accept contributions under a DCO only                   | Certifies provenance, grants no relicensing right (ADR 0014). Contributed code would have to be excluded from every commercial build, which is unworkable once it touches shared code                                                                           |
| Keep the CLA check live but treat it as advisory        | The bot still asks a contributor to sign a draft to unblock a pull request that will not be merged. Wastes their effort and misrepresents the project's actual state                                                                                            |
| Delete the CLA draft and the workflow                   | Throws away finished work for tidiness. Both are inert while disabled, and having them ready is exactly what makes the decision cheap to reverse                                                                                                                |
