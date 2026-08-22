# Trello export fixtures

**The files directly in this directory are synthetic; the files under `real/` are not.** The
top-level fixtures were hand-written in this repository on 2026-08-15, from memory of Trello's
export format, and checked against nothing on that date. `real/` holds two anonymised **real**
Trello exports, dated 2026-08-22 — see [Real exports](#real-exports) below and
[`real/README.md`](real/README.md). Do not read a passing test against the synthetic files as
evidence that the importer handles Trello's actual output; that evidence is what `real/` and its
e2e spec are for.

That distinction is the whole reason this file opens with it. Trello's export schema carries no
version field and no changelog, so "the Trello importer works" is a claim about a date and about
the files that were on hand on that date. On 2026-08-15, no real export was on hand: the person
running this project had no Trello data to export, and an agent cannot open a Trello account.
Calling an invented JSON file `real-1.json` would have made the fixtures measure our own
imagination and then labelled the result "validated" — which is why the synthetic fixtures below
stay named as edge cases and a full board, never as `real-*`.

The roadmap metric that asked for validation against two real Trello exports closed on
2026-08-22, when the two files under `real/` went in and passed
`trello-import-real.e2e-spec.ts` end to end. It reopens, in the sense that the field-mapping
diffs below get another row, the next time a real export shows a shape this repository did not
anticipate — from the maintainer or from a community bug report — at which point **the export
wins, not this repository**.

## What the importer does about that

Because no field name was verified against a real export until 2026-08-22, the reader's contract
is not "I know Trello's schema" — it is **"I report what I do not know"**
(`apps/api/src/import/trello-export.ts`,
[ADR 0025](../../../../../docs/decisions/0025-trello-import-mapping.md)). A missing field, a field
of an unexpected type, or an entry the reader cannot represent is dropped into the import's
`(scope, reason)` report and reading continues. Only two things are errors: a body that is not
JSON at all, and a root object that does not look like a board export.

`edge-unknown-shape.json` exists to hold that contract still. It is the fixture a schema drift
would look like, and the tests that read it assert both halves: the readable rows come across,
_and_ the unreadable ones are reported rather than thrown.

## The fixtures

| Fixture                     | Written    | What it is                                                                                                                                                                                                                                                          | Real? |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `synthetic-full-board.json` | 2026-08-15 | Four lists (one archived), six cards (one archived, one unnamed), five labels (one unnamed, one uncoloured, one unknown colour), three checklists across two cards, three attachments (http, https, `file:`), two comments plus one non-comment action, two members | no    |
| `edge-empty-board.json`     | 2026-08-15 | A board with no lists and no cards                                                                                                                                                                                                                                  | no    |
| `edge-empty-list.json`      | 2026-08-15 | One list, no cards in it                                                                                                                                                                                                                                            | no    |
| `edge-unknown-color.json`   | 2026-08-15 | Labels coloured `tangerine`, `null` and `sky_light`                                                                                                                                                                                                                 | no    |
| `edge-unknown-shape.json`   | 2026-08-15 | Right root, wrong everything else — see the list below                                                                                                                                                                                                              | no    |
| `edge-card-export.json`     | 2026-08-15 | Trello's _card_ export — valid JSON, has a `name`, is not a board                                                                                                                                                                                                   | no    |
| `edge-truncated.json`       | 2026-08-15 | A valid export cut off mid-object; **deliberately not valid JSON**                                                                                                                                                                                                  | no    |

`synthetic-full-board.json` is not an edge case and is not named like one. It is the only
synthetic fixture describing an ordinary board, so the mapping tests run against it — which means
its shortcomings are the mapping tests' shortcomings, and they are the shortcomings the opening
paragraphs describe: hand-written, and checked against nothing until `real/` existed.

A few things in it are deliberate rather than incidental, because a test depends on each:

- **The lists are not in `pos` order in the file.** `Backlog` (16384) is written after
  `In Progress` (32768). A reader that returned the array untouched and a reader that sorted it
  would otherwise be indistinguishable.
- **`pos` values are Trello-sized** (16384, 32768, 65535) and nowhere near this repository's
  `POSITION_GAP` of 1000, so a test can tell a re-issued position from a carried-over one by
  looking at the number.
- **One attachment URL is `file:`.** It must never become an `Attachment` row.
- **One action is not a `commentCard`.** The comment count has to be a count of comments, not a
  count of actions.
- **One label has an empty name and one has no colour**, which are the two cases ADR 0025 has to
  invent a name and a colour for.

## What is wrong inside `edge-unknown-shape.json`

Every entry in it exists because a mutation of the reader survived without it — that is, because
the reader could be broken in that specific way and every test stayed green. The fixture grew
during that exercise rather than being designed up front, and it is worth keeping in that order:
each row below is a bug the suite could not previously see.

- A bare number where a list should be, and a list with no `id` at all.
- A list whose `name` is an array **and** whose `closed` is a string — the entry that proves the
  reader counts unreadable _entries_ and not unreadable _fields_.
- A list whose only problem is `closed: "true"`. Without it, a `closed` check that silently
  coerced went unnoticed, and an archived list arriving as a live column is a wrong import rather
  than an incomplete one.
- `pos: "bottom"` on a list that is otherwise fine, which must **not** be reported: ADR 0025
  already decided that a non-numeric `pos` falls back to id order.
- `labels` as an object, `members` as a string, `actions` as an object — three whole sections
  disappearing, one report row each.
- A card whose `idLabels` is a string, a card carrying an attachment with no usable `url`, a card
  whose `due` is an epoch number rather than an ISO string, and an entry that is a bare string.
  The `due` one is there because a nullable field that swallows a wrong type is the quietest
  failure in the reader: the user loses a due date and hears nothing.
- A checklist with one unreadable item (reported as an item, so the readable items survive) and a
  checklist whose `checkItems` is a string (reported as a checklist).

`edge-truncated.json` is listed in the repository's `.prettierignore`, because it is invalid JSON
on purpose and `prettier --check` would otherwise fail on it. That entry is load-bearing: if
someone "fixes" the file so the formatter is happy, the test that proves a half-downloaded export
answers 400 instead of crashing starts passing for the wrong reason.

## Real exports

The `v0.3.0` gate asked for at least two anonymised real exports importing end to end
(`ROADMAP.md`, Hardening track), and it closed on 2026-08-22: `real/` holds
`starter-guide-board.json` (Trello's own default "Starter Guide" board) and
`eleven-list-board.json` (an eleven-list board exported the same day), and both import cleanly
through `trello-import-real.e2e-spec.ts`.

**Where they are.** [`real/`](real/README.md). `trello-import-real.e2e-spec.ts` reads every
`*.json` in that directory at module load and imports each one through
`POST /workspaces/:id/imports/trello` as an admin, deriving the expected counts from the file by
ADR 0025's rules and comparing them with the report and with the database. If the directory were
ever empty again the spec would report exactly one skipped test,
`no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)`; with two files in
it, it instead runs one test per file.

**How to add another one.**

1. In Trello, open the board menu: **More**, **Print and export**, **Export as JSON**.
2. `node scripts/anonymise-trello-export.mjs ~/Downloads/board.json apps/api/test/fixtures/trello/real/<name>.json --seed <anything>`.
   The script keeps the export's structure byte for byte (keys, order, lengths, nulls, numbers,
   dates, colours, `closed` flags, id relationships) and replaces every piece of text with a
   deterministic pseudonym of the same length and shape. Trello ids keep their eight-character
   timestamp prefix and their sort order, because the planner ties on them.
3. Read the summary it prints: unrecognised top-level keys and strings replaced under keys the
   script did not know to carry text were anonymised as text, which is safe but may have changed a
   non-text value's shape. Skim the file once before pushing it; it is public from then on.
4. Run `pnpm --filter @kurul/api test:e2e`, read what fails, and add a row below.

`real/*.json` is listed in `.prettierignore` on purpose: those files are the script's output, byte
for byte, and reformatting them would make "the file the script wrote" and "the file in the repo"
two different things.

The guard that the anonymiser changes nothing the importer reads runs on every CI run regardless:
the same spec anonymises `synthetic-full-board.json` through the CLI and asserts the two imports
produce the same report and the same board, shape for shape.

### Field-mapping diffs

One row per place where a real export disagreed with what the synthetic fixtures assume. Both
files under `real/` were checked against every field `apps/api/src/import/trello-export.ts` reads.

| Field                                                                                                                                                                                                                                                           | Synthetic fixture assumption                                                                                                                                                                              | What the real export showed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Importer change needed |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Every field the reader touches: `lists[].{id,name,pos,closed}`, `cards[].{id,name,desc,idList,pos,closed,due,idLabels,idMembers,attachments[].{id,name,url}}`, `labels[].{id,name,color}`, `checklists[].{id,idCard,name,pos,checkItems[].{id,name,state,pos}}` | The types and shapes `trello-export.ts` and ADR 0025 already assume (string ids, numeric `pos`, boolean `closed`, nullable `desc`/`due`/`color`, a `_dark`/`_light` colour suffix stripped before lookup) | Matched on both files, with two shapes worth naming because they exercise assumptions the synthetic fixture does not: `lists[].pos` is sometimes fractional (`32767.5`, `49151.25`, not just Trello's classic powers of two), and `labels[].color` carries `purple_light` — the `_light` suffix, alongside the `_dark` one the synthetic fixture already covers. `labels[].name` is `""` on Trello's own unnamed default labels, `cards[].due` is `null` on every card in both files, and `checklists[].checkItems[].state` is the string `"incomplete"` (neither file happens to contain a completed item). Neither export contains an archived list or card (`closed` is `false` throughout), so the archived path is still exercised only by the synthetic fixture. | none                   |

No field the importer reads needed a code change. Both exports carry well over a hundred fields
the reader never looks at — `nodeId`, `creationMethod`/`creationMethodError`/
`creationMethodLoadingPhase`/`creationMethodLoadingStartedAt`, `premiumFeatures`, `pluginData[]`
(and its `access`/`scope` sub-fields), `cards[].badges` (including `badges.fogbugz`, always `""`
in both files), and `cards[].originalName`/`originalDesc` among them. These are exactly the sort
of field ADR 0025 says is out of scope by design, and the anonymiser's summary flags the ones it
does not know to carry text so a maintainer can skim them before a file is pushed; none of them
changes what a board looks like after import.
