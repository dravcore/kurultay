import { BadRequestException } from '@nestjs/common';
import { TrelloImportScope, TrelloImportSkipReason } from '@kurul/shared-types';

/**
 * Only the fields the importer reads. Everything else in a Trello export is ignored on purpose:
 * a Trello board carries well over a hundred fields, and typing all of them would turn every
 * upstream schema change into a compile error, including changes to fields nothing here reads.
 *
 * **These names were written from memory and checked against two real Trello exports on
 * 2026-08-22** (`apps/api/test/fixtures/trello/real/`, diffs in
 * `apps/api/test/fixtures/trello/README.md#field-mapping-diffs`) — with no diff found on any
 * field below. That is one date and two boards, not a guarantee about Trello's schema going
 * forward, which is why this file still reports rather than throws — see `parseTrelloExport`.
 */
export interface TrelloExport {
  name: string;
  desc: string | null;
  lists: TrelloList[];
  cards: TrelloCard[];
  labels: TrelloLabel[];
  checklists: TrelloChecklist[];
  /** Counted, never imported (ADR 0025). Only `commentCard` entries are counted. */
  commentCount: number;
  /** Counted, never imported (ADR 0025). */
  memberCount: number;
}

export interface TrelloList {
  id: string;
  name: string;
  /** `null` when absent or non-numeric; ordering falls back to `id` (ADR 0025). */
  pos: number | null;
  /** Trello's archive flag. */
  closed: boolean;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string | null;
  /** The Trello list this card sits in, or `null` when the export did not say. */
  idList: string | null;
  pos: number | null;
  closed: boolean;
  /** ISO 8601, straight from the export. Parsing into a `Date` is the planner's job. */
  due: string | null;
  idLabels: string[];
  idMembers: string[];
  attachments: TrelloAttachment[];
}

export interface TrelloLabel {
  id: string;
  /** Often `''` in a real board — Trello lets a label be a colour with no name. */
  name: string;
  /** Trello's colour name, possibly with a `_dark` / `_light` suffix. `null` is legal. */
  color: string | null;
}

export interface TrelloChecklist {
  id: string;
  /** The Trello card this checklist hangs off, or `null` when the export did not say. */
  idCard: string | null;
  name: string;
  pos: number | null;
  checkItems: TrelloCheckItem[];
}

export interface TrelloCheckItem {
  id: string;
  name: string;
  /** `'complete'` / `'incomplete'` in every export seen so far; kept open as a string. */
  state: string | null;
  pos: number | null;
}

export interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
}

/**
 * Something the reader could not read, in the report's own vocabulary.
 *
 * Deliberately *not* grouped or capped here. Grouping and the sample cap belong to the collector
 * the planner uses, so that the reader's issues and the planner's skips end up in one list with
 * one set of counts rather than two lists the reader of the report has to add up.
 */
export interface TrelloReadIssue {
  scope: TrelloImportScope;
  reason: TrelloImportSkipReason;
  /** A name, when the reader could see one. `null` when there was nothing readable to quote. */
  sample: string | null;
}

export interface TrelloExportReadResult {
  source: TrelloExport;
  issues: TrelloReadIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One entry's worth of field reads, tracking whether anything was unusable.
 *
 * The tracking exists so a single bad entry produces a single report row. Reporting per *field*
 * would mean a card with a wrongly typed `name`, `desc` and `closed` counts as three skipped
 * cards, and `count` in the report is supposed to be a number of things, not a number of
 * complaints.
 *
 * `null` and `undefined` are not "unusable": Trello writes `null` for an empty description, an
 * unset due date and an uncoloured label, and omits arrays it has nothing to put in. A value of
 * the wrong *type* is a different event — it means the export said something this reader could
 * not understand — and that is the one worth telling the user about.
 */
class EntryFields {
  unusable = false;

  string(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null) this.unusable = true;
    return fallback;
  }

  nullableString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null) this.unusable = true;
    return null;
  }

  boolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value !== undefined && value !== null) this.unusable = true;
    return false;
  }

  stringArray(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.unusable = true;
      return [];
    }
    const strings = value.filter((entry): entry is string => typeof entry === 'string');
    if (strings.length !== value.length) this.unusable = true;
    return strings;
  }

  array(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.unusable = true;
      return [];
    }
    return value;
  }
}

/**
 * A sibling's sort key.
 *
 * Never marks an entry unusable, and that is the difference between this and `EntryFields`.
 * Trello writes large floats here, repeats them, and on some exports writes the string
 * `"bottom"`; ADR 0025 already decided what happens then — the order falls back to the Trello id.
 * A decision that is already written down is not a surprise to report.
 */
function readPos(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An identity: the field without which the entry cannot be referred to or written at all. */
function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readList(entry: unknown): TrelloList | null {
  if (!isRecord(entry)) return null;
  const id = readId(entry.id);
  if (id === null) return null;

  const fields = new EntryFields();
  const list: TrelloList = {
    id,
    name: fields.string(entry.name, ''),
    pos: readPos(entry.pos),
    closed: fields.boolean(entry.closed),
  };
  return fields.unusable ? null : list;
}

function readAttachment(entry: unknown): TrelloAttachment | null {
  if (!isRecord(entry)) return null;
  // The identity of an attachment is its URL, not its id. An attachment row is a URL plus a
  // label for it (ADR 0024's LINK kind), so an entry without a usable URL carries nothing —
  // while an entry whose `id` this repository guessed wrong still carries everything that
  // matters. Requiring `id` here would drop every attachment on the day Trello renames it.
  const url = readId(entry.url);
  if (url === null) return null;

  const fields = new EntryFields();
  const attachment: TrelloAttachment = {
    id: fields.string(entry.id, ''),
    name: fields.string(entry.name, url),
    url,
  };
  return fields.unusable ? null : attachment;
}

function readCard(entry: unknown): TrelloCard | null {
  if (!isRecord(entry)) return null;
  const id = readId(entry.id);
  if (id === null) return null;

  const fields = new EntryFields();
  const attachments: TrelloAttachment[] = [];
  for (const raw of fields.array(entry.attachments)) {
    const attachment = readAttachment(raw);
    if (attachment === null) fields.unusable = true;
    else attachments.push(attachment);
  }

  const card: TrelloCard = {
    id,
    name: fields.string(entry.name, ''),
    desc: fields.nullableString(entry.desc),
    idList: fields.nullableString(entry.idList),
    pos: readPos(entry.pos),
    closed: fields.boolean(entry.closed),
    due: fields.nullableString(entry.due),
    idLabels: fields.stringArray(entry.idLabels),
    idMembers: fields.stringArray(entry.idMembers),
    attachments,
  };
  return fields.unusable ? null : card;
}

function readLabel(entry: unknown): TrelloLabel | null {
  if (!isRecord(entry)) return null;
  const id = readId(entry.id);
  if (id === null) return null;

  const fields = new EntryFields();
  const label: TrelloLabel = {
    id,
    // An empty name and a `null` colour are not degradations here: ADR 0025 already decided what
    // an unnamed and an uncoloured label become, and the planner reports that substitution as
    // `(label, defaulted)`. Reporting it twice, once as malformed and once as defaulted, would
    // describe one label as two problems.
    name: fields.string(entry.name, ''),
    color: fields.nullableString(entry.color),
  };
  return fields.unusable ? null : label;
}

function readCheckItem(entry: unknown): TrelloCheckItem | null {
  if (!isRecord(entry)) return null;
  const id = readId(entry.id);
  if (id === null) return null;

  const fields = new EntryFields();
  const item: TrelloCheckItem = {
    id,
    name: fields.string(entry.name, ''),
    state: fields.nullableString(entry.state),
    pos: readPos(entry.pos),
  };
  return fields.unusable ? null : item;
}

function readChecklist(entry: unknown, issues: TrelloReadIssue[]): TrelloChecklist | null {
  if (!isRecord(entry)) return null;
  const id = readId(entry.id);
  if (id === null) return null;

  const fields = new EntryFields();
  const checkItems: TrelloCheckItem[] = [];
  for (const raw of fields.array(entry.checkItems)) {
    const item = readCheckItem(raw);
    // An unreadable item is reported as an item, not as a checklist: dropping the whole list
    // because one of its lines was odd would lose the readable lines too, and ADR 0023's reason
    // for a multi-list model was that a card's checklists carry the grouping their author made.
    if (item === null) {
      issues.push({
        scope: TrelloImportScope.ChecklistItem,
        reason: TrelloImportSkipReason.Malformed,
        sample: null,
      });
    } else {
      checkItems.push(item);
    }
  }

  const checklist: TrelloChecklist = {
    id,
    idCard: fields.nullableString(entry.idCard),
    name: fields.string(entry.name, ''),
    pos: readPos(entry.pos),
    checkItems,
  };
  return fields.unusable ? null : checklist;
}

/**
 * A top-level array of the export, read entry by entry.
 *
 * An absent section is reported, and that is not over-reporting. A missing `cards` key is what a
 * renamed field looks like from in here, and the alternative — treat it as "this board has no
 * cards" — is the one failure mode this reader exists to avoid: an import that silently brings
 * across nothing and reports success. Per-*card* arrays are treated the other way round (see
 * `EntryFields.array`), because a card with no attachments really is ordinary.
 */
function readSection<T>(
  raw: unknown,
  scope: TrelloImportScope,
  issues: TrelloReadIssue[],
  read: (entry: unknown) => T | null,
): T[] {
  if (!Array.isArray(raw)) {
    issues.push({ scope, reason: TrelloImportSkipReason.Malformed, sample: null });
    return [];
  }

  const rows: T[] = [];
  for (const entry of raw) {
    const row = read(entry);
    if (row === null) {
      issues.push({
        scope,
        reason: TrelloImportSkipReason.Malformed,
        sample: isRecord(entry) && typeof entry.name === 'string' ? entry.name : null,
      });
    } else {
      rows.push(row);
    }
  }
  return rows;
}

/** Counts entries of one `actions[]` type without keeping any of them. */
function countActions(raw: unknown, issues: TrelloReadIssue[]): number {
  if (!Array.isArray(raw)) {
    issues.push({
      scope: TrelloImportScope.Comment,
      reason: TrelloImportSkipReason.Malformed,
      sample: null,
    });
    return 0;
  }
  return raw.filter((entry) => isRecord(entry) && entry.type === 'commentCard').length;
}

function countMembers(raw: unknown, issues: TrelloReadIssue[]): number {
  if (!Array.isArray(raw)) {
    issues.push({
      scope: TrelloImportScope.Member,
      reason: TrelloImportSkipReason.Malformed,
      sample: null,
    });
    return 0;
  }
  return raw.length;
}

/**
 * Bytes to a narrowed export plus a list of everything that could not be read.
 *
 * **The contract is "I report what I do not know", not "I know Trello's schema."** Every field
 * name in this file was written from memory and has since been checked against two real exports
 * (`apps/api/test/fixtures/trello/README.md#field-mapping-diffs`), but Trello's schema carries no
 * version field and no changelog, so a reader that threw on anything unexpected would still turn
 * the next schema drift into a total failure. Instead: a field of an unexpected type, an entry
 * that cannot be represented, or a whole section that is missing lands in `issues` as a
 * `(scope, reason)` pair and reading continues.
 *
 * Exactly two things are errors, and both mean "this is not the file you think it is" rather than
 * "this file has a surprise in it":
 *
 *   * it is not JSON at all — a truncated download, a renamed ZIP, the wrong file entirely;
 *   * it is JSON, but the root is not a board: no `name` string, or no `lists` array. A Trello
 *     *card* export is exactly this, and it is a real thing people upload.
 *
 * Those two fields are the only ones whose absence is fatal, and that is a deliberate line: they
 * are what makes the file recognisable at all, and if the reader relaxed them it would happily
 * "import" any JSON document as an empty board.
 *
 * `JSON.parse` over the whole body is the most expensive line here and it runs before any
 * tenant work, which is why the multipart size limit is the layer that has to hold and why this
 * is called from the service rather than from a validation pipe — a pipe would put that parse in
 * front of the guard chain.
 */
export function parseTrelloExport(bytes: Buffer): TrelloExportReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BadRequestException('This file is not valid JSON — export the board again');
  }

  if (!isRecord(raw) || typeof raw.name !== 'string' || !Array.isArray(raw.lists)) {
    throw new BadRequestException('This does not look like a Trello board export');
  }

  const issues: TrelloReadIssue[] = [];
  const source: TrelloExport = {
    name: raw.name,
    // The board's own description has no scope in the report vocabulary, so an unusable value
    // here falls back silently. It is one string on one board rather than a class of rows, and
    // inventing a `board` scope to carry it would put a word in the user's report that appears
    // once and means nothing to them.
    desc: typeof raw.desc === 'string' ? raw.desc : null,
    lists: readSection(raw.lists, TrelloImportScope.List, issues, readList),
    cards: readSection(raw.cards, TrelloImportScope.Card, issues, readCard),
    labels: readSection(raw.labels, TrelloImportScope.Label, issues, readLabel),
    checklists: readSection(raw.checklists, TrelloImportScope.Checklist, issues, (entry) =>
      readChecklist(entry, issues),
    ),
    commentCount: countActions(raw.actions, issues),
    memberCount: countMembers(raw.members, issues),
  };

  return { source, issues };
}
