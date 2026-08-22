#!/usr/bin/env node
/**
 * Anonymises a real Trello board export so it can be committed as an importer fixture.
 *
 * ## Why this exists
 *
 * Every Trello fixture under `apps/api/test/fixtures/trello/` was hand-written from memory and
 * checked against nothing (that directory's README, ADR 0025). The only way to find out where
 * the importer's idea of Trello's schema is wrong is to import a board Trello actually exported,
 * and a board somebody actually used is full of names, e-mail addresses, attachment URLs and
 * card text that do not belong in a public repository.
 *
 * This script keeps the first thing and removes the second. The structure of the export, which
 * is all the importer reads, survives byte for byte: keys, key order, array lengths, nulls,
 * booleans, numbers (`pos` included), dates, colours, `closed` flags and every id relationship.
 * The text is replaced by deterministic pseudonyms of the same length and shape. The rules, and
 * their order, live in `scripts/lib/trello-anonymiser.mjs`.
 *
 * ## Usage
 *
 *     node scripts/anonymise-trello-export.mjs <input.json> <output.json> [--seed <string>]
 *
 * The same input and seed produce the same output, so a fixture can be regenerated from the
 * original if the rules change. The seed defaults to `kurul`; pass your own if you would rather
 * the pseudonyms in the committed file could not be reproduced by anyone holding the original.
 *
 * The output is written the way the input was: Trello's minified single line stays a single line
 * (a pretty-printed copy would be half as large again, and the import size limit is the same for
 * both), and a file that was indented is written back with the same indent.
 *
 * The summary printed at the end counts what the export contains and lists every top-level key
 * and every string-carrying key path the script did not recognise. Read that list before
 * committing the output: an unknown key was anonymised as text, which is the safe default, but
 * a value that was not text (a number written as a string, an enum) may have lost its shape.
 *
 * Node built-ins only, like everything in `scripts/`.
 */
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { anonymiseTrelloExport } from './lib/trello-anonymiser.mjs';

const USAGE =
  'usage: node scripts/anonymise-trello-export.mjs <input.json> <output.json> [--seed <string>]';

function parseArgs(argv) {
  const positional = [];
  let seed;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--seed') {
      const value = argv[index + 1];
      if (value === undefined || value === '') throw new Error('--seed needs a value');
      seed = value;
      index += 1;
    } else if (token.startsWith('--')) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const [input, output] = positional;
  if (resolve(input) === resolve(output)) {
    throw new Error('Refusing to overwrite the input: name a different output file');
  }
  return { input, output, seed };
}

function formatSummary(summary, outputPath, bytes) {
  const { counts } = summary;
  const lines = [
    `wrote ${outputPath} (${bytes} bytes)`,
    `  lists ${counts.lists} (${counts.archivedLists} archived), cards ${counts.cards} ` +
      `(${counts.archivedCards} archived), labels ${counts.labels}`,
    `  checklists ${counts.checklists}, checkItems ${counts.checkItems}, ` +
      `attachments ${counts.attachments}`,
    `  members ${counts.members}, comments ${counts.comments}, customFields ${counts.customFields}`,
    `  ids remapped ${summary.idsRemapped}`,
  ];
  if (summary.unknownTopLevelKeys.length === 0) {
    lines.push('  unrecognised top-level keys: none');
  } else {
    lines.push(`  unrecognised top-level keys: ${summary.unknownTopLevelKeys.join(', ')}`);
  }
  if (summary.unrecognisedStringKeys.length === 0) {
    lines.push('  strings replaced under keys not known to carry text: none');
  } else {
    lines.push('  strings replaced under keys not known to carry text (check these by hand):');
    for (const path of summary.unrecognisedStringKeys) lines.push(`    ${path}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The indentation the input was written with, so the output is formatted the same way. Trello
 * exports are minified, and pretty-printing one grows it by half: a board that fits under
 * `TRELLO_IMPORT_MAX_BYTES` as exported must not stop fitting because of this script.
 */
function indentOf(text) {
  const match = /^\s*[[{]\r?\n([ \t]+)\S/.exec(text);
  return match === null ? undefined : match[1];
}

function main(argv) {
  const { input, output, seed } = parseArgs(argv);

  let text;
  let parsed;
  try {
    text = readFileSync(input, 'utf8');
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not read ${input} as JSON: ${error.message}`, { cause: error });
  }

  const { output: anonymised, summary } = anonymiseTrelloExport(
    parsed,
    seed === undefined ? {} : { seed },
  );
  const trailingNewline = text.endsWith('\n') ? '\n' : '';
  const json = `${JSON.stringify(anonymised, null, indentOf(text))}${trailingNewline}`;
  writeFileSync(output, json, 'utf8');
  return formatSummary(summary, output, Buffer.byteLength(json, 'utf8'));
}

try {
  process.stdout.write(main(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`anonymise-trello-export: ${error.message}\n`);
  process.exit(1);
}
