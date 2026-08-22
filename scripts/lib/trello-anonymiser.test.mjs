/**
 * Unit tests for the Trello export anonymiser, on `node:test` because `scripts/` has no
 * dependencies and must keep having none. Run with `pnpm test:scripts`.
 *
 * The integration half, which proves that an anonymised export still *imports* the same way,
 * lives in `apps/api/test/trello-import-real.e2e-spec.ts` and drives the CLI.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_TOP_LEVEL_KEYS,
  anonymiseTrelloExport,
  pseudonymText,
  pseudonymUrl,
  summariseTrelloExport,
} from './trello-anonymiser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join(ROOT, 'scripts', 'anonymise-trello-export.mjs');
const FIXTURE = join(
  ROOT,
  'apps',
  'api',
  'test',
  'fixtures',
  'trello',
  'synthetic-full-board.json',
);

const ID_RE = /^[0-9a-f]{24}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

/**
 * The export with every string replaced by a marker of its kind, so two exports can be compared
 * on structure alone: key order, array lengths, nulls, numbers, booleans all survive the marker.
 */
function shapeOf(value) {
  if (typeof value === 'string') {
    if (ID_RE.test(value)) return '<id>';
    if (ISO_DATE_RE.test(value)) return `<date:${value}>`;
    const scheme = /^(?:https?|ftp|file|mailto):/i.exec(value);
    if (scheme !== null) return `<url:${scheme[0]}>`;
    return `<string:${value.length}>`;
  }
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shapeOf(entry)]));
  }
  return value;
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out));
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStrings(entry, out));
  }
  return out;
}

describe('anonymiseTrelloExport', () => {
  it('keeps the structure: key order, lengths, nulls, numbers, booleans, dates', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'structure' });

    assert.deepEqual(shapeOf(output), shapeOf(input));
    assert.deepEqual(Object.keys(output), Object.keys(input));
    assert.equal(output.lists[1].pos, 16384);
    assert.equal(output.lists[2].closed, true);
    assert.equal(output.cards[0].due, '2026-09-01T17:00:00.000Z');
    assert.equal(output.cards[1].attachments[1].bytes, 20481);
    assert.equal(output.cards[1].attachments[1].edgeColor, '#4a3aa7');
    assert.equal(output.cards[1].attachments[1].mimeType, 'image/png');
    assert.equal(output.checklists[0].checkItems[0].state, 'complete');
    assert.equal(output.actions[2].type, 'updateCard');
  });

  it('keeps label colours, including null and the ones the importer does not know', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'colours' });

    assert.deepEqual(
      output.labels.map((label) => label.color),
      input.labels.map((label) => label.color),
    );
  });

  it('is deterministic for one seed and different across seeds', () => {
    const input = loadFixture();

    const first = anonymiseTrelloExport(input, { seed: 'a' });
    const second = anonymiseTrelloExport(input, { seed: 'a' });
    const other = anonymiseTrelloExport(input, { seed: 'b' });

    assert.deepEqual(first.output, second.output);
    assert.notEqual(first.output.name, other.output.name);
    assert.notEqual(first.output.cards[0].id, other.output.cards[0].id);
  });

  it('maps every id the same way everywhere, so relationships survive', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'ids' });

    const listIdMap = new Map(input.lists.map((list, index) => [list.id, output.lists[index].id]));
    input.cards.forEach((card, index) => {
      assert.equal(output.cards[index].idList, listIdMap.get(card.idList));
      assert.equal(output.cards[index].idBoard, output.id);
    });
    const labelIdMap = new Map(
      input.labels.map((label, index) => [label.id, output.labels[index].id]),
    );
    input.cards.forEach((card, index) => {
      assert.deepEqual(
        output.cards[index].idLabels,
        card.idLabels.map((id) => labelIdMap.get(id)),
      );
    });
    const cardIdMap = new Map(input.cards.map((card, index) => [card.id, output.cards[index].id]));
    input.checklists.forEach((checklist, index) => {
      assert.equal(output.checklists[index].idCard, cardIdMap.get(checklist.idCard));
    });
    assert.equal(output.actions[0].data.card.id, cardIdMap.get(input.actions[0].data.card.id));
    // No original id leaks anywhere in the output.
    const originalIds = new Set(collectStrings(input).filter((value) => ID_RE.test(value)));
    for (const value of collectStrings(output)) assert.equal(originalIds.has(value), false);
  });

  it('keeps the timestamp prefix and the sort order of ids, which the planner ties on', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'order' });

    const originals = input.lists.map((list) => list.id);
    const mapped = output.lists.map((list) => list.id);
    mapped.forEach((id, index) => {
      assert.match(id, ID_RE);
      assert.equal(id.slice(0, 8), originals[index].slice(0, 8));
    });
    const orderOf = (ids) =>
      [...ids]
        .map((id, index) => [id, index])
        .sort()
        .map(([, i]) => i);
    assert.deepEqual(orderOf(mapped), orderOf(originals));
  });

  it('replaces names and descriptions with text of the same length', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'text' });

    assert.notEqual(output.name, input.name);
    assert.equal(output.name.length, input.name.length);
    input.cards.forEach((card, index) => {
      assert.equal(output.cards[index].name.length, card.name.length);
      assert.equal(output.cards[index].desc.length, card.desc.length);
      if (card.name !== '') assert.notEqual(output.cards[index].name, card.name);
    });
    // An empty name stays empty: the importer reports it as malformed either way.
    assert.equal(output.cards[5].name, '');
    assert.equal(output.labels[1].name, '');
    // The same original text becomes the same pseudonym wherever it appears.
    assert.equal(output.actions[0].data.card.name, output.cards[1].name);
  });

  it('does not leak the original words', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'leak' });

    const json = JSON.stringify(output);
    for (const phrase of [
      'Product Roadmap',
      'Ada Placeholder',
      'adaplaceholder',
      'Board drag and drop',
      'Old Sprint',
      'trello.com',
      'wireframe',
      'Local spec copy',
      'pin the fixture',
    ]) {
      assert.equal(json.includes(phrase), false, `leaked: ${phrase}`);
    }
  });

  it('keeps URL schemes and extensions, and moves every host to example.invalid', () => {
    const input = loadFixture();

    const { output } = anonymiseTrelloExport(input, { seed: 'urls' });

    const attachments = output.cards[1].attachments;
    assert.match(attachments[0].url, /^https:\/\/example\.invalid\/[0-9a-f]{16}$/);
    assert.match(attachments[1].url, /^https:\/\/example\.invalid\/[0-9a-f]{16}\.png$/);
    assert.match(attachments[2].url, /^file:\/\/\/[0-9a-f]{16}\.md$/);
    assert.match(attachments[1].name, /\.png$/);
    assert.match(attachments[1].fileName, /\.png$/);
    assert.match(output.url, /^https:\/\/example\.invalid\//);
    assert.match(output.shortUrl, /^https:\/\/example\.invalid\//);
    assert.equal(output.cards[0].shortLink.length, input.cards[0].shortLink.length);
    assert.notEqual(output.cards[0].shortLink, input.cards[0].shortLink);
  });

  it('keeps a URL that also matches the e-mail shape a URL, under a URL key and in text', () => {
    const input = loadFixture();
    const card = input.cards[1];
    const attachment = (id, url) => ({ ...card.attachments[0], id, name: 'x', url });
    card.attachments.push(
      attachment('6512a1b7c3d4e5f601020373', 'mailto:someone@corp.example'),
      attachment('6512a1b7c3d4e5f601020374', 'https://user:pw@intranet.corp.example/report.pdf'),
      attachment('6512a1b7c3d4e5f601020375', 'https://github.com/org/repo/blob/main/@types/x.d.ts'),
      attachment('6512a1b7c3d4e5f601020376', 'ftp://backup@files.corp.example/dump.zip'),
      // Not a URL at all: the importer calls it malformed, and must still be able to.
      attachment('6512a1b7c3d4e5f601020377', 'someone@corp.example'),
    );
    card.desc = 'mailto:ada@corp.example';
    input.members[0].email = 'ada@corp.example';

    const { output } = anonymiseTrelloExport(input, { seed: 'email-shaped urls' });

    const urls = output.cards[1].attachments.slice(3).map((entry) => entry.url);
    assert.match(urls[0], /^mailto:[0-9a-f]{16}@example\.invalid$/);
    assert.match(urls[1], /^https:\/\/example\.invalid\/[0-9a-f]{16}\.pdf$/);
    assert.match(urls[2], /^https:\/\/example\.invalid\/[0-9a-f]{16}\.ts$/);
    assert.match(urls[3], /^ftp:\/\/example\.invalid\/[0-9a-f]{16}\.zip$/);
    assert.match(urls[4], /^[0-9a-f]{12}@example\.invalid$/);
    assert.match(output.cards[1].desc, /^mailto:[0-9a-f]{16}@example\.invalid$/);
    assert.match(output.members[0].email, /^[0-9a-f]{12}@example\.invalid$/);
    const json = JSON.stringify(output);
    for (const leak of ['corp.example', 'github.com', 'user:pw', '@types', 'someone', 'ada@']) {
      assert.equal(json.includes(leak), false, `leaked: ${leak}`);
    }
  });

  it('keeps a file extension only on an attachment name, never on prose', () => {
    const input = loadFixture();
    input.cards[0].name = 'Review PR from k.smith';
    input.cards[0].desc = 'Notes:\nCall Mrs.Johnson\n- mail j.doe';
    input.actions[0].data.text = 'Ping a.kowalski';
    input.lists[0].name = 'Dr.Smith';
    input.checklists[0].checkItems[0].name = 'ask m.brown.md';
    const attachments = input.cards[1].attachments;
    attachments[0].name = 'k.smith';
    attachments[1].name = 'wireframe-v2.png';
    attachments[1].fileName = 'wireframe-v2.png';

    const { output } = anonymiseTrelloExport(input, { seed: 'tails' });

    assert.equal(output.cards[0].name.length, 'Review PR from k.smith'.length);
    assert.equal(output.cards[0].desc.split('\n').length, 3);
    assert.match(output.cards[1].attachments[1].name, /^[a-z-]+\.png$/);
    assert.match(output.cards[1].attachments[1].fileName, /^[a-z-]+\.png$/);
    assert.equal(output.cards[1].attachments[0].name.length, 'k.smith'.length);
    // A checklist item is prose even when it ends like a file name.
    assert.doesNotMatch(output.checklists[0].checkItems[0].name, /\.md$/);
    const json = JSON.stringify(output);
    for (const tail of ['smith', 'Smith', 'Johnson', '.doe', 'kowalski', 'brown']) {
      assert.equal(json.includes(tail), false, `leaked: ${tail}`);
    }
  });

  it('pseudonymises members but keeps their ids and member types', () => {
    const input = loadFixture();
    input.members[0].email = 'ada@company.example';
    input.members[0].memberType = 'admin';
    input.members[0].avatarHash = 'abcdef0123456789abcdef0123456789';
    input.members[0].avatarUrl = 'https://trello-members.s3.amazonaws.com/abc/def';
    input.members[0].bio = 'Works on the importer.';

    const { output } = anonymiseTrelloExport(input, { seed: 'members' });

    const member = output.members[0];
    assert.equal(member.memberType, 'admin');
    assert.match(member.email, /^[0-9a-f]{12}@example\.invalid$/);
    assert.match(member.avatarHash, /^[0-9a-f]{32}$/);
    assert.notEqual(member.avatarHash, input.members[0].avatarHash);
    assert.match(member.avatarUrl, /^https:\/\/example\.invalid\//);
    assert.match(member.initials, /^[A-Z]{2}$/);
    assert.match(member.username, /^[a-z]+$/);
    assert.equal(member.username.length, input.members[0].username.length);
    assert.equal(member.bio.length, input.members[0].bio.length);
    assert.equal(member.fullName.length, input.members[0].fullName.length);
    assert.equal(member.id, output.cards[0].idMembers[0]);
  });

  it('anonymises custom fields, their options and the values on cards', () => {
    const input = loadFixture();
    input.customFields = [
      {
        id: '6512a1bcc3d4e5f601020501',
        idModel: input.id,
        modelType: 'board',
        fieldGroup: 'abc123',
        display: { cardFront: true },
        name: 'Customer',
        pos: 16384,
        options: [
          {
            id: '6512a1bcc3d4e5f601020502',
            idCustomField: '6512a1bcc3d4e5f601020501',
            value: { text: 'Acme Corp' },
            color: 'green',
            pos: 16384,
          },
        ],
        type: 'list',
      },
    ];
    input.cards[0].customFieldItems = [
      {
        id: '6512a1bcc3d4e5f601020503',
        idValue: '6512a1bcc3d4e5f601020502',
        idCustomField: '6512a1bcc3d4e5f601020501',
        idModel: input.cards[0].id,
        modelType: 'card',
      },
      {
        id: '6512a1bcc3d4e5f601020504',
        value: { number: '1250', checked: 'true', date: '2026-08-01T00:00:00.000Z' },
        idCustomField: '6512a1bcc3d4e5f601020501',
        idModel: input.cards[0].id,
        modelType: 'card',
      },
    ];

    const { output, summary } = anonymiseTrelloExport(input, { seed: 'fields' });

    const field = output.customFields[0];
    assert.equal(field.type, 'list');
    assert.equal(field.modelType, 'board');
    assert.equal(field.idModel, output.id);
    assert.notEqual(field.name, 'Customer');
    assert.equal(field.name.length, 'Customer'.length);
    assert.notEqual(field.options[0].value.text, 'Acme Corp');
    assert.equal(field.options[0].color, 'green');
    assert.equal(field.options[0].idCustomField, field.id);
    const items = output.cards[0].customFieldItems;
    assert.equal(items[0].idValue, field.options[0].id);
    assert.match(items[1].value.number, /^\d{4}$/);
    assert.notEqual(items[1].value.number, '1250');
    assert.equal(items[1].value.checked, 'true');
    assert.equal(items[1].value.date, '2026-08-01T00:00:00.000Z');
    assert.equal(summary.counts.customFields, 1);
  });

  it('treats a string under an unknown key as text and reports the key path', () => {
    const input = loadFixture();
    input.cards[0].badges = { fogbugz: 'case 4711', votes: 0 };
    input.labelNames = { green: 'Go', red: '' };
    input.somethingNew = [{ id: '6512a1bdc3d4e5f601020601', caption: 'Quarterly numbers' }];

    const { output, summary } = anonymiseTrelloExport(input, { seed: 'unknown' });

    assert.notEqual(output.cards[0].badges.fogbugz, 'case 4711');
    assert.equal(output.cards[0].badges.fogbugz.length, 'case 4711'.length);
    assert.equal(output.cards[0].badges.votes, 0);
    assert.notEqual(output.labelNames.green, 'Go');
    assert.equal(output.labelNames.red, '');
    assert.notEqual(output.somethingNew[0].caption, 'Quarterly numbers');
    assert.match(output.somethingNew[0].id, ID_RE);
    assert.deepEqual(summary.unknownTopLevelKeys, ['somethingNew']);
    assert.deepEqual(summary.unrecognisedStringKeys, [
      'cards[].badges.fogbugz',
      'somethingNew[].caption',
    ]);
  });

  it('recognises every top-level key of the synthetic fixture', () => {
    const input = loadFixture();

    const { summary } = anonymiseTrelloExport(input);

    assert.deepEqual(summary.unknownTopLevelKeys, []);
    assert.deepEqual(summary.unrecognisedStringKeys, []);
    for (const key of Object.keys(input)) assert.equal(KNOWN_TOP_LEVEL_KEYS.has(key), true);
  });

  it('counts what the export contains the way the import report does', () => {
    const input = loadFixture();

    const { summary } = anonymiseTrelloExport(input);

    assert.deepEqual(summary.counts, {
      lists: 4,
      archivedLists: 1,
      cards: 6,
      archivedCards: 1,
      labels: 5,
      checklists: 3,
      checkItems: 5,
      attachments: 3,
      members: 2,
      comments: 2,
      customFields: 0,
    });
    assert.equal(summary.idsRemapped, 33);
  });

  it('refuses anything that is not a board export', () => {
    assert.throws(() => anonymiseTrelloExport({ name: 'A card', idList: 'x' }), /board export/);
    assert.throws(() => anonymiseTrelloExport([]), /board export/);
    assert.throws(() => anonymiseTrelloExport(null), /board export/);
  });
});

describe('pseudonymText', () => {
  it('keeps line count, indentation, bullets, headings, checkboxes and fences', () => {
    const original = [
      '# Release notes',
      '',
      'Some intro text here.',
      '- first bullet',
      '  - nested bullet',
      '1. numbered',
      '- [x] done task',
      '- [ ] open task',
      '> a quote',
      '```',
      'code stays',
      '```',
      '---',
      'Trailing line  ',
    ].join('\n');

    const out = pseudonymText(original, 'md');

    const originalLines = original.split('\n');
    const outLines = out.split('\n');
    assert.equal(outLines.length, originalLines.length);
    outLines.forEach((line, index) => {
      assert.equal(line.length, originalLines[index].length, `line ${index}`);
    });
    assert.match(outLines[0], /^# [A-Z]/);
    assert.equal(outLines[1], '');
    assert.match(outLines[3], /^- [a-z]/);
    assert.match(outLines[4], /^ {2}- [a-z]/);
    assert.match(outLines[5], /^1\. [a-z]/);
    assert.match(outLines[6], /^- \[x\] [a-z]/);
    assert.match(outLines[7], /^- \[ \] [a-z]/);
    assert.match(outLines[8], /^> [a-z]/);
    assert.equal(outLines[9], '```');
    assert.equal(outLines[11], '```');
    assert.equal(outLines[12], '---');
    assert.match(outLines[13], / {2}$/);
    assert.equal(out.includes('Release notes'), false);
    assert.equal(out.includes('intro'), false);
  });

  it('keeps empty and whitespace-only text as it is', () => {
    assert.equal(pseudonymText('', 's'), '');
    assert.equal(pseudonymText('   ', 's'), '   ');
    assert.equal(pseudonymText('\n\n', 's'), '\n\n');
  });

  it('keeps a file extension on request, and keeps a one-token file name one token', () => {
    const keep = { keepExtension: true };
    const spaced = pseudonymText('quarterly report final.pdf', 's', keep);
    const single = pseudonymText('wireframe-v2.png', 's', keep);
    const upper = pseudonymText('SCAN.PDF', 's', keep);

    assert.match(spaced, /^[a-z ]+\.pdf$/);
    assert.equal(spaced.length, 'quarterly report final.pdf'.length);
    assert.match(single, /^[a-z-]+\.png$/);
    assert.equal(single.length, 'wireframe-v2.png'.length);
    assert.match(upper, /^[A-Za-z-]+\.PDF$/);
  });

  it('does not keep the tail of a first.last handle or an honorific, even as a file name', () => {
    // Every one of these matches the `stem.ext` shape that a file name has.
    const lines = [
      'Review PR from k.smith',
      'Talk to Dr.Smith',
      'Ping a.kowalski',
      'Notes:\nCall Mrs.Johnson\n- mail j.doe',
      'k.smith',
    ];
    for (const original of lines) {
      for (const options of [undefined, { keepExtension: true }]) {
        const out = pseudonymText(original, 's', options);

        assert.equal(out.length, original.length, original);
        for (const tail of ['smith', 'Smith', 'kowalski', 'Johnson', '.doe']) {
          assert.equal(out.includes(tail), false, `${JSON.stringify(original)} leaked ${tail}`);
        }
      }
    }
    // Without the option a real file name loses its extension too: prose never keeps a tail.
    assert.doesNotMatch(pseudonymText('wireframe-v2.png', 's'), /\.png$/);
  });

  it('keeps a leading capital and the exact length of a one-line name', () => {
    const out = pseudonymText('Fix the login page', 's');

    assert.match(out, /^[A-Z]/);
    assert.equal(out.length, 'Fix the login page'.length);
    assert.equal(out.endsWith(' '), false);
  });
});

describe('pseudonymUrl', () => {
  it('returns null for a string that is not a URL, so a malformed one stays malformed', () => {
    assert.equal(pseudonymUrl('not a url', 's'), null);
  });

  it('keeps the scheme apart from http/https', () => {
    assert.match(
      pseudonymUrl('mailto:ada@company.example', 's'),
      /^mailto:[0-9a-f]+@example\.invalid$/,
    );
    assert.match(pseudonymUrl('javascript:alert(1)', 's'), /^javascript:[0-9a-f]{16}$/);
    assert.match(
      pseudonymUrl('http://intranet.local/x.docx', 's'),
      /^http:\/\/example\.invalid\/[0-9a-f]{16}\.docx$/,
    );
  });

  it('keeps only a known file extension from the path, so a handle in a URL is not a tail', () => {
    assert.match(
      pseudonymUrl('https://github.com/j.smith', 's'),
      /^https:\/\/example\.invalid\/[0-9a-f]{16}$/,
    );
    assert.match(
      pseudonymUrl('https://files.example/a/b/Report.PDF', 's'),
      /^https:\/\/example\.invalid\/[0-9a-f]{16}\.PDF$/,
    );
  });
});

describe('summariseTrelloExport', () => {
  it('tolerates missing and wrongly typed sections rather than throwing', () => {
    assert.deepEqual(summariseTrelloExport({ name: 'x', lists: [], cards: 'nope' }), {
      lists: 0,
      archivedLists: 0,
      cards: 0,
      archivedCards: 0,
      labels: 0,
      checklists: 0,
      checkItems: 0,
      attachments: 0,
      members: 0,
      comments: 0,
      customFields: 0,
    });
  });
});

describe('the CLI', () => {
  function run(args, options = {}) {
    return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...options });
  }

  it('writes the anonymised export and prints the summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kurul-anonymise-'));
    try {
      const out = join(dir, 'out.json');

      const stdout = run([FIXTURE, out, '--seed', 'cli']);

      const text = readFileSync(out, 'utf8');
      const written = JSON.parse(text);
      assert.deepEqual(written, anonymiseTrelloExport(loadFixture(), { seed: 'cli' }).output);
      // The fixture is indented by two spaces and ends in a newline; so does its anonymisation.
      assert.match(text, /^\{\n {2}"id": /);
      assert.equal(text.endsWith('}\n'), true);
      assert.match(stdout, /lists 4 \(1 archived\), cards 6 \(1 archived\), labels 5/);
      assert.match(stdout, /checklists 3, checkItems 5, attachments 3/);
      assert.match(stdout, /members 2, comments 2, customFields 0/);
      assert.match(stdout, /unrecognised top-level keys: none/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a minified export back minified, as Trello exports it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kurul-anonymise-'));
    try {
      const input = join(dir, 'in.json');
      const out = join(dir, 'out.json');
      writeFileSync(input, JSON.stringify(loadFixture()));

      const stdout = run([input, out, '--seed', 'cli']);

      const text = readFileSync(out, 'utf8');
      assert.equal(text.includes('\n'), false);
      assert.deepEqual(
        JSON.parse(text),
        anonymiseTrelloExport(loadFixture(), { seed: 'cli' }).output,
      );
      assert.match(stdout, new RegExp(`\\(${Buffer.byteLength(text, 'utf8')} bytes\\)`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists the top-level keys it did not recognise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kurul-anonymise-'));
    try {
      const input = join(dir, 'in.json');
      const out = join(dir, 'out.json');
      writeFileSync(input, JSON.stringify({ ...loadFixture(), extra: 'x', another: 1 }));

      const stdout = run([input, out]);

      assert.match(stdout, /unrecognised top-level keys: extra, another/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite its input and exits non-zero on bad input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kurul-anonymise-'));
    try {
      const notJson = join(dir, 'broken.json');
      writeFileSync(notJson, '{"name": "x", "lists": [');

      assert.throws(() => run([FIXTURE, FIXTURE], { stdio: 'pipe' }), /Refusing to overwrite/);
      assert.throws(() => run([notJson, join(dir, 'o.json')], { stdio: 'pipe' }), /as JSON/);
      assert.throws(() => run([FIXTURE], { stdio: 'pipe' }), /usage:/);
      assert.throws(
        () => run([FIXTURE, join(dir, 'o.json'), '--bogus'], { stdio: 'pipe' }),
        /Unknown option/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
