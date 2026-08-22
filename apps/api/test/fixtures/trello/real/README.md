# Anonymised real Trello exports

Every `*.json` file in this directory is a **real** Trello board export that went through
`scripts/anonymise-trello-export.mjs` before it was committed. Nothing here is hand-written:
the point of the directory is that its structure came from Trello, not from this repository's
memory of Trello (see [`../README.md`](../README.md) and
[ADR 0025](../../../../../../docs/decisions/0025-trello-import-mapping.md)).

The anonymiser keeps the export's shape byte for byte (keys, key order, array lengths, nulls,
booleans, numbers, dates, colours, `closed` flags, every id relationship) and replaces every
piece of text with deterministic pseudonyms of the same length and shape. What the importer
reads is unchanged; what a person wrote is gone.

## Fixtures

| Fixture                    | Board                                                                  | Seed    | Exported   | Counts                                                                                   |
| -------------------------- | ---------------------------------------------------------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------- |
| `starter-guide-board.json` | Trello's own default "Starter Guide" board                             | `kurul` | 2026-08-22 | 4 lists, 7 cards, 6 labels, 7 checklists / 22 items, 6 attachments, 1 member, 0 comments |
| `eleven-list-board.json`   | An eleven-list board, exported the same day to widen the shape covered | —       | 2026-08-22 | 11 lists, 11 cards, 6 labels, 0 checklists, 14 actions                                   |

Both import cleanly end to end through `trello-import-real.e2e-spec.ts`; the field-mapping diffs
they turned up (none on a field the reader uses) are recorded in
[`../README.md`](../README.md#field-mapping-diffs).

## Adding one

1. In Trello: board menu, **More**, **Print and export**, **Export as JSON**. Save the file.
2. Run the anonymiser, with a seed of your own if you do not want the pseudonyms to be
   reproducible from the original:

   ```bash
   node scripts/anonymise-trello-export.mjs ~/Downloads/board.json \
     apps/api/test/fixtures/trello/real/<short-name>.json --seed <anything>
   ```

3. Read the summary it prints. An unrecognised top-level key or a string replaced under a key
   the script did not know to carry text is worth a look before committing: the value was
   anonymised (the safe default), but a non-text value may have lost its shape. Numbers are
   kept verbatim, so a board that used the Map power-up carries its `coordinates` across.
4. Skim the output for anything the script could not have known was personal. The file is
   public once it is pushed.
5. Add a row to the fixture table in [`../README.md`](../README.md) and, after the first run,
   fill in the **Field-mapping diffs** table there.

Keep the file under `TRELLO_IMPORT_MAX_BYTES` (20 MiB by default): the harness imports it
through the real endpoint with the production limit and does not raise it, because a real
export that does not fit is a finding, not a test-setup problem. A board with a few hundred
cards is a few megabytes. The script writes the output the way the input was formatted, so
Trello's minified single line stays a single line; do not pretty-print the export first, that
alone grows it by half.

## What reads it

`apps/api/test/trello-import-real.e2e-spec.ts` picks up every `*.json` here at module load and
imports each one end to end through `POST /workspaces/:id/imports/trello` as an admin. The
expected counts are derived from the file itself by the rules ADR 0025 states (archived lists
and cards are skipped, unnamed ones are malformed, attachments become links when their scheme
is `http` or `https`, comments and members are counted and dropped), and compared with both the
import report and the rows in the database. A failure is not necessarily a bug in the test: it
is the first place a difference between Trello's schema and this repository's idea of it shows
up, and the export wins. Record what you found in the diffs table and fix the importer.

If this directory ever holds no `*.json` again, that spec reports exactly one skipped test named
`no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)`, so an open gate
stays visible in every CI run rather than showing nothing at all. With the two files above in
place, it runs one test per file instead.
