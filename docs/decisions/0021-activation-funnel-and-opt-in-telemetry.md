# 0021. Activation Funnel In-Instance, Telemetry Opt-In and Off by Default

**Status:** Accepted
**Date:** 2026-08-14

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0021-activation-funnel-and-opt-in-telemetry.md)

## Context

Kurul measured nothing about its own use. A grep for `telemetry`, `analytics`, `posthog`,
`plausible` or `umami` across `apps/` and `docs/` returned zero matches in source, and the
roadmap (now [ROADMAP.md](../../ROADMAP.md)) listed no metrics item under "Beyond MVP". So every
product question was answered by intuition:

- Where does onboarding break — sign-up, workspace, board, first card, first invite?
- Do invitations convert, and when they do not, is that the invite flow or an instance with no
  SMTP transport (in which case an invitee _cannot_ accept at all, per ADR 0013)?
- Does anybody come back next week — and does anybody use this as a **team**, which is the only
  usage that justifies the product existing rather than a to-do list?

None of that is a nice-to-have for a solo maintainer. It is the difference between spending a
quarter on the thing that is losing people and spending it on the thing that was easiest to
build.

The obvious fix is also the one that would do the most damage. Self-hosters choose self-hosted
software substantially _because_ it does not report on them, and the failure mode is not a
lost user — it is the "Kurul phones home" thread that outlives whatever the feature was
worth. Several projects have paid that price for a default-on ping, however anonymous.

So two questions have to be answered separately, because they have different answers:

1. May the instance measure **itself**, for its own operator?
2. May the instance tell **us** anything?

There is also a fortunate precondition. The `Activity` table has recorded
`<subject>.<past-tense verb>` plus an actor since the feed shipped, and PR #188 (audit SEC-05)
added the administrative half of that vocabulary — `board.*`, `column.*`, `label.*`,
`workspace.updated`, `member.*`, `invitation.*` — for the audit trail. Most of an activation
funnel is already in the database; the question was mostly how to read it, not what to write.

## Decision

**Two layers, decided independently.**

### Layer 1 — the activation funnel, in-instance, always on

Eleven steps, computed on demand from rows this instance already holds and served to the
instance operator over the ordinary API (`GET /instance/activation`). **Nothing computed here
is ever sent anywhere.**

| #   | Step                 | Where the number comes from                                         |
| --- | -------------------- | ------------------------------------------------------------------- |
| 1   | `user_registered`    | `COUNT(User)`                                                       |
| 2   | `workspace_created`  | distinct `WorkspaceMember.userId` where `role = OWNER`              |
| 3   | `board_created`      | distinct actors on `Activity` `board.created`                       |
| 4   | `first_task_created` | distinct actors on `task.created`                                   |
| 5   | `first_drag`         | distinct actors on `task.moved`                                     |
| 6   | `invite_sent`        | distinct actors on `invitation.created`                             |
| 7   | `smtp_configured`    | `MailService.isEnabled()` — the deployment, not a person            |
| 8   | `invite_accepted`    | distinct actors on `invitation.accepted` (the actor is the invitee) |
| 9   | `dashboard_viewed`   | distinct users with a `UsagePing` of kind `dashboard_view`          |
| 10  | `task_completed`     | distinct actors on `task.moved` into a `COMPLETED` column           |
| 11  | `wau_board_view`     | distinct users with a `board_view` `UsagePing` in the last 7 days   |

Nine of the eleven are **derived** — no new write path anywhere in the request cycle. Two are
not, and needed one new table.

**North Star: Weekly Active Team Workspaces.** Workspaces with two or more members where two or
more _current_ members left a trace in the last seven days. Returned alongside two context
figures (weekly active workspaces of any size, and workspaces with 2+ members at all), because
"3" is excellent out of four team workspaces and a crisis out of four hundred.

**Who may read it: `INSTANCE_ADMIN_EMAILS` (grant once those accounts' emails are verified), empty by default, meaning nobody.** This is the
only authorisation boundary in the codebase that is not a workspace role, and it exists because
the funnel is the first thing that legitimately reads across tenants.

### Layer 2 — outbound telemetry, opt-in, off by default

One `POST` at process start, only when the operator has set **both**
`TELEMETRY_ENABLED=true` **and** `TELEMETRY_ENDPOINT`. Neither has a default that sends
anything. The complete payload, with no other fields at all:

```json
{ "event": "instance_started", "version": "0.1.0" }
```

No instance identifier, no hostname, no IP, no counts, no workspace or user data. Not awaited,
never retried, cannot fail a boot. `docs/development.md` repeats this field list as the
promise, and `TelemetryPingPayload` in `@kurul/shared-types` is its specification —
`telemetry.service.spec.ts` asserts the key set is exactly `event` and `version`.

## Rationale

**Why the funnel is derived rather than emitted.** Adding eleven `INSERT`s across eleven
services would have been the shorter patch and is worse on three counts. A derived funnel is
_retroactive_ — an instance that upgrades into this release sees its whole history, not a flat
line starting at the deploy. It cannot leak: the failure PR #188 had to correct was an
`invitation.*` payload carrying the invited e-mail address into a feed every GUEST could read,
which is structurally impossible for a query that reads only columns the schema already had.
And nothing on the hot path gets slower; creating a task remains one transaction.

**Why `UsagePing` exists anyway.** `Activity` records what somebody _changed_. A team that
reads its board every morning and moves nothing changes nothing, so a retention metric derived
from `Activity` alone would report the quietest healthy instances as dead — precisely inverting
the signal it exists to give. The table stores the minimum that answers "did they show up":
one row per (user, workspace, kind, UTC day), deduplicated by a unique index and written with
`ON CONFLICT DO NOTHING`. No board id, no path, no user agent, no address, no count. It is
swept by the existing nightly job under `ACTIVITY_RETENTION_DAYS` (ADR 0020) rather than
growing a window of its own — same class of row, one decision for the operator to make.

**Why a `GET` writes.** The two pings are recorded inside `GET /workspaces/:id/boards/:boardId`
and `GET /workspaces/:id/dashboard/summary`, not by a browser beacon. The request _is_ the
view: reaching the handler means the guard passed and the workspace resolved, which no
client-side call can vouch for and which an extension cannot block. The write is not awaited
and every failure is swallowed into a warning, so a metrics table that is full or missing
cannot stop a team seeing their board. The purity of the verb buys nothing here: there is no
cache and no read replica in this deployment that a written-to `GET` would corrupt.

**Why `INSTANCE_ADMIN_EMAILS` and not a role.** Three alternatives were rejected. _Any workspace
`OWNER`_ is not a boundary at all — registration is open on a default install and creating a
workspace makes you its owner, so every visitor can grant themselves the role. A `User.isAdmin`
_column_ would need a UI, an escalation path to audit and a first-admin bootstrap problem: a
permanent new attack surface bought for one read-only screen. _No boundary at all_ is the
PR #188 mistake repeated — a payload, or a page, must never widen who can read something, and
instance-wide counts are something no workspace member was ever entitled to. Configuration is
the honest boundary: whoever can read `DATABASE_URL` may name the accounts that see
instance-wide numbers. Empty by default means a fresh install shows this to nobody, including
its own owner, until somebody writes an address into `.env` on purpose, and access is gated
further by requiring those accounts' email addresses to be verified.

**Why telemetry is off, and why it carries no instance id.** Off by default is not a courtesy;
it is the only default compatible with what self-hosted software is _for_. A user who has to
discover a switch and turn it off has already had something taken from them.

The instance id is the harder call, and we chose the less useful side deliberately. With an id,
a collector counts installs; without one it counts _starts_, so a crash-looping container looks
like a hundred installs and a stable server that never reboots looks like none. That is a real
loss of signal. But a stable random id is a pseudonymous identifier for a deployment, and the
promise that makes this switch worth flipping is that it is anonymous with **nothing to take on
trust** — no id to correlate, no id to leak, no id an operator has to believe we do not join
against something else. A future maintainer who wants install counts should reopen this as a
decision, not add a field in a patch.

**Why there is no default endpoint.** Shipping one would put a hard-coded third-party address
in an AGPL codebase self-hosters are asked to audit, and Dravcore publishes no collector today
— a default pointing at a domain that does not answer is a promise the code cannot keep. Making
the operator name the destination also makes "point it at my own collector" a first-class use
rather than a workaround.

## Consequences

**Easier.** The North Star becomes measurable for the first time, and every drop in the funnel
is attributable to a specific step rather than to a guess. `smtp_configured` sits between
"invite sent" and "invite accepted" precisely so that a bad conversion reads as "our server
cannot send mail" rather than "our invite flow is confusing". A self-hoster gets the same
screen for their own deployment: this is not analytics for us that happens to run on their
hardware, it is analytics for them.

**Harder.** There is one new table to migrate and sweep, and two `GET` handlers now perform a
write, which is a shape that has to be defended in review every time somebody notices it. The
funnel query is six aggregate scans of `Activity`, uncached; on a very large instance this
screen will be the slowest page in the product, and the fix when that day comes is an index,
not a stale copy.

**The honest cost of the telemetry decision.** Because it is off by default, carries no id and
has no published collector, we will learn approximately nothing about install counts in the
near term. That is the price of the promise, paid knowingly. The switch exists so the
conversation is already settled the day there _is_ a collector, and so an operator who wants to
send their own instance's heartbeat somewhere has a supported way to do it.

**What an operator has to do to see any of this.** Set `INSTANCE_ADMIN_EMAILS` to their own
address, verify that account's email, and reload the settings screen. Doing nothing leaves the funnel computed-but-unreadable
and the ping unsent, which is the correct behaviour for somebody who never asked for either.

## Alternatives considered

| Alternative                                       | Why not                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A third-party SDK (PostHog, Plausible, Umami, GA) | Sends data off the box by construction, adds a dependency an auditor must trust, and cannot answer "what leaves here" with a file list |
| Default-on anonymous ping, opt-out                | The exact decision that costs a self-hosted project its reputation; a user who must find a switch to turn it off has already lost      |
| Emit eleven counters from eleven services         | No history before the deploy, a new write path per metric, and every one of them a place a payload can leak (see PR #188)              |
| Funnel readable by any workspace `OWNER`          | Not a boundary: open registration plus "create a workspace" makes everyone an owner                                                    |
| A `User.isAdmin` column with a UI                 | A permanent privilege-escalation surface and a bootstrap problem, bought for one read-only screen                                      |
| A `POST /usage` beacon from the browser           | A second round trip per page view, and the truth of "did they open the board" moves into client code an extension can block            |
| Store every board view (no per-day dedupe)        | That is a browsing history, not a metric; the question is "did they show up", never "how many times"                                   |
| A separate `USAGE_PING_RETENTION_DAYS`            | Two windows on the same class of row that can silently disagree; ADR 0020's `ACTIVITY_RETENTION_DAYS` already states the policy        |
| Include a stable instance id in the ping          | Pseudonymous identifier for a deployment; the anonymity promise is worth more than the install count (see Rationale)                   |
