/**
 * The transform behind `scripts/anonymise-trello-export.mjs`: a Trello board export in, the same
 * export with every piece of personal or proprietary text replaced out.
 *
 * ## What "the same export" means here
 *
 * The importer (`apps/api/src/import/`) reads structure, not prose: which keys exist, which
 * arrays are how long, which `closed` flags are set, which `pos` values order which siblings,
 * which card points at which list. All of that is kept byte for byte. Keys keep their names and
 * their order, arrays keep their length, `null` stays `null`, numbers and booleans are untouched,
 * ISO dates and colour values are untouched, and a Trello id is replaced by another 24-hex id in
 * a way that keeps every relationship: the same id becomes the same pseudonym wherever it appears,
 * whether as a list's `id`, a card's `idList`, an entry in `idLabels` or the key of an object.
 *
 * What changes is text. Names, descriptions, comments, usernames, e-mail addresses, URLs and
 * anything else that reads as written by a person become deterministic pseudonyms derived from a
 * seeded hash of the original, so the same input and seed produce the same output, and a card
 * name repeated inside an action's `data.card.name` becomes the same pseudonym both times.
 *
 * Text keeps its *length class* and its *shape*: an empty string stays empty, a one-word name
 * stays one word long, a 2,000-character description stays 2,000 characters with the same line
 * count and the same bullet markers, because how the importer handles a long markdown description
 * is part of what a real export is there to test.
 *
 * ## What is not recognised is still anonymised, and is reported
 *
 * Trello's export schema has no version field (ADR 0025), so this file cannot know every key.
 * The rules below are therefore written value-first: a 24-hex string is an id wherever it is, a
 * URL is a URL under any key, and a string under a key this file has never heard of is treated
 * as text and replaced. Privacy is the default, and the summary lists every unrecognised key
 * path whose value was replaced that way, plus every top-level key the script does not know, so
 * an unknown shape is visible rather than silently passed through.
 *
 * Numbers are kept verbatim. That is the one place the structural promise wins over privacy: a
 * board that used the Map power-up carries `coordinates`, and those are numbers.
 *
 * Node built-ins only, and no `import.meta`, so the integration suite can run this through the
 * CLI and the unit tests can import it directly.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const ID_RE = /^[0-9a-f]{24}$/i;
const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Schemes worth recognising as a URL under *any* key; other schemes only count under URL keys. */
const SPECIAL_SCHEME_RE = /^(?:https?|ftp|file|mailto|data|javascript|wss?):/i;
const NUMERIC_RE = /^[+-]?\d+(?:\.\d+)?$/;
const FILENAME_RE = /^[^/\\]+(\.[a-z0-9]{1,8})$/i;
/**
 * Extensions a kept file name may end in. A `.smith` or `.doe` is not on this list, so a handle
 * that happens to sit under a file-name key loses its tail like any other text.
 */
const FILE_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif webp svg bmp tif tiff heic ico psd ai sketch fig eps ' +
    'pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt md csv tsv log key numbers pages ' +
    'zip gz tgz tar bz2 7z rar dmg iso ' +
    'json xml yaml yml toml ini html htm css js mjs cjs ts tsx jsx py rb go rs java kt sh sql ' +
    'mp3 mp4 mov avi mkv wav m4a ogg webm ' +
    'ttf otf woff woff2 ics eml msg'
  ).split(' '),
);
const FENCE_OR_RULE_RE = /^\s*(?:```|~~~|(?:[-*_]\s*){3,}$)/;
/** Indent, an optional list/heading/quote marker, an optional task checkbox; then the text. */
const LINE_RE = /^(\s*(?:(?:[-*+]|\d{1,3}[.)]|#{1,6}|>+)\s+)?(?:\[[ xX]\]\s+)?)(.*?)(\s*)$/;

/** Top-level keys of a Trello board export, as far as this repository knows them. */
export const KNOWN_TOP_LEVEL_KEYS = new Set([
  'id',
  'nodeId',
  'name',
  'desc',
  'descData',
  'closed',
  'dateClosed',
  'idOrganization',
  'idEnterprise',
  'limits',
  'pinned',
  'starred',
  'url',
  'prefs',
  'shortLink',
  'subscribed',
  'labelNames',
  'powerUps',
  'dateLastActivity',
  'dateLastView',
  'shortUrl',
  'idTags',
  'datePluginDisable',
  'creationMethod',
  'ixUpdate',
  'templateGallery',
  'enterpriseOwned',
  'idBoardSource',
  'premiumFeatures',
  'idMemberCreator',
  'type',
  'memberships',
  'actions',
  'cards',
  'labels',
  'lists',
  'members',
  'checklists',
  'customFields',
  'pluginData',
  'organization',
]);

/**
 * Keys whose string values are Trello's own vocabulary rather than a person's words: enum-like
 * values the importer reads (`state`, `type`, `color`) or may read one day. Kept verbatim.
 */
const KEEP_KEYS = new Set([
  // Trello writes `"bottom"` for `pos` and, on some exports, `"true"` for `closed`; the importer
  // treats both as vocabulary, not as text.
  'pos',
  'closed',
  'type',
  'state',
  'status',
  'color',
  'memberType',
  'modelType',
  'mimeType',
  'permissionLevel',
  'voting',
  'comments',
  'invitations',
  'cardAging',
  'background',
  'backgroundBrightness',
  'viewType',
  'size',
  'brightness',
  'checked',
  'locale',
  'cardRole',
  'creationMethod',
  'translationKey',
  'fieldGroup',
]);

/** Keys this file knows carry a person's text. Anything else that reads as text is reported. */
const TEXT_KEYS = new Set([
  'name',
  'desc',
  'text',
  'fullName',
  'displayName',
  'username',
  'initials',
  'bio',
  'fileName',
  'value',
  'title',
  'label',
  'shortLink',
  'avatarHash',
  'logoHash',
  'address',
  'locationName',
  'aaId',
  'email',
  'website',
  'number',
]);

/** Keys whose *children* are text whatever they are called: `labelNames` is keyed by colour. */
const TEXT_PARENT_KEYS = new Set(['labelNames']);

/** A key that names a URL, whatever the value looks like. */
function isUrlKey(key) {
  return /url$/i.test(key) || key === 'backgroundImage' || key === 'sharedSourceUrl';
}

/**
 * A key whose value names a file, so its extension may stay: an attachment's `fileName`, and
 * its `name`, which Trello fills with the uploaded file's name. A card or list `name` is prose.
 */
function isFileNameKey(key, parentKey) {
  return key === 'fileName' || (key === 'name' && parentKey === 'attachments');
}

const LOREM = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
  'enim',
  'ad',
  'minim',
  'veniam',
  'quis',
  'nostrud',
  'exercitation',
  'ullamco',
  'laboris',
  'nisi',
  'aliquip',
  'ex',
  'ea',
  'commodo',
  'consequat',
];

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const HEX = '0123456789abcdef';
const ALNUM = `${UPPER}${LOWER}${DIGITS}`;

/**
 * A stream of bytes that depends on the seed, the kind of value and the original value, and on
 * nothing else: the same original string always gets the same pseudonym. SHA-256 is used for its
 * distribution and availability, not for secrecy; the seed is what keeps two anonymisations of
 * the same board from being trivially joined.
 */
function byteStream(seed, kind, original) {
  let block = 0;
  let bytes = Buffer.alloc(0);
  let offset = 0;
  return () => {
    if (offset >= bytes.length) {
      bytes = createHash('sha256')
        .update(`${seed}\u0000${kind}\u0000${original}\u0000${block}`)
        .digest();
      block += 1;
      offset = 0;
    }
    const byte = bytes[offset];
    offset += 1;
    return byte;
  };
}

function digestHex(seed, kind, original, length) {
  return createHash('sha256')
    .update(`${seed}\u0000${kind}\u0000${original}`)
    .digest('hex')
    .slice(0, length);
}

/** `length` characters drawn from `alphabet`, deterministically for `(seed, kind, original)`. */
function charsOfLength(length, alphabet, seed, kind, original) {
  const next = byteStream(seed, kind, original);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[next() % alphabet.length];
  }
  return out;
}

/** Lorem words joined by spaces, cut to exactly `length` characters. */
function loremOfLength(length, seed, original) {
  if (length <= 0) return '';
  const next = byteStream(seed, 'text', original);
  let out = '';
  while (out.length < length) {
    const word = LOREM[next() % LOREM.length];
    out += out === '' ? word : ` ${word}`;
  }
  out = out.slice(0, length);
  // A pseudonym that ends in a space would be trimmed by the importer and change length class.
  if (out.endsWith(' ')) out = `${out.slice(0, -1)}m`;
  return out;
}

/**
 * The text part of one line, same length, same leading capital. Only a file name keeps its
 * extension, and only one from `FILE_EXTENSIONS`: the rule is opt-in because "Review PR from
 * k.smith" and "Call Dr.Smith" match the same `stem.ext` shape, and a trailing token kept
 * verbatim in a card name or a comment is a name leaked into a public fixture.
 */
function pseudonymContent(content, seed, keepExtension) {
  if (content === '') return '';
  const filename = keepExtension ? FILENAME_RE.exec(content) : null;
  if (filename !== null && FILE_EXTENSIONS.has(filename[1].slice(1).toLowerCase())) {
    const extension = filename[1];
    const stem = content.slice(0, content.length - extension.length);
    const lorem = loremOfLength(stem.length, seed, stem);
    // A file name without spaces stays one token; hyphens keep the length where spaces would not.
    return `${stem.includes(' ') ? lorem : lorem.replace(/ /g, '-')}${extension}`;
  }
  let out = loremOfLength(content.length, seed, content);
  const first = content[0];
  if (first !== undefined && first !== first.toLowerCase()) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

/**
 * Free text, line by line. Every line keeps its indent, its list marker, its heading hashes,
 * its task checkbox and its trailing whitespace; only the words change. Code fences and
 * horizontal rules are kept whole. The line count is therefore the same, and so is the length
 * of every line.
 *
 * With `keepExtension` a line that looks like `stem.ext` keeps its extension; the caller sets it
 * only for values that name a file (an attachment's `name` or `fileName`), never for prose.
 */
export function pseudonymText(original, seed, { keepExtension = false } = {}) {
  if (original === '') return '';
  return original
    .split('\n')
    .map((line) => {
      if (FENCE_OR_RULE_RE.test(line)) return line;
      const match = LINE_RE.exec(line);
      if (match === null) return loremOfLength(line.length, seed, line);
      const [, prefix, content, suffix] = match;
      return `${prefix}${pseudonymContent(content, seed, keepExtension)}${suffix}`;
    })
    .join('\n');
}

/** The last path segment's extension, if it is one from `FILE_EXTENSIONS`; `/u/j.smith` has none. */
function extensionOf(pathname) {
  const last = pathname.split('/').pop() ?? '';
  const match = /(\.[a-z0-9]{1,8})$/i.exec(last);
  if (match === null || !FILE_EXTENSIONS.has(match[1].slice(1).toLowerCase())) return '';
  return match[1];
}

/**
 * A URL with the same scheme and the same file extension, on `example.invalid` (RFC 2606).
 * Returns `null` when the string does not parse as a URL at all, so the caller can fall back
 * to text and a malformed attachment URL stays malformed.
 */
export function pseudonymUrl(original, seed) {
  let parsed;
  try {
    parsed = new URL(original);
  } catch {
    return null;
  }
  const hash = digestHex(seed, 'url', original, 16);
  const extension = extensionOf(parsed.pathname);
  const { protocol } = parsed;
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'ftp:') {
    return `${protocol}//example.invalid/${hash}${extension}`;
  }
  if (protocol === 'file:') return `file:///${hash}${extension}`;
  if (protocol === 'mailto:') return `mailto:${hash}@example.invalid`;
  return `${protocol}${hash}`;
}

export function pseudonymEmail(original, seed) {
  return `${digestHex(seed, 'email', original, 12)}@example.invalid`;
}

/** Digits become other digits, one for one; sign and decimal point stay where they were. */
function pseudonymNumeric(original, seed) {
  const next = byteStream(seed, 'numeric', original);
  return original.replace(/\d/g, () => DIGITS[next() % DIGITS.length]);
}

/**
 * The id map for one export.
 *
 * Trello ids are 24 hex characters whose leading eight are a creation timestamp, and the
 * planner's tie-break on equal `pos` sorts by that id (ADR 0025). So the prefix is kept, and
 * within one prefix the pseudonyms are handed out in the same order as the originals, which
 * keeps every id comparison the importer makes answering the same way. The suffixes themselves
 * are hashes of `(seed, id)`; only their assignment within a same-second group is order-based.
 */
function buildIdMap(ids, seed) {
  const byPrefix = new Map();
  for (const id of ids) {
    const lower = id.toLowerCase();
    const prefix = lower.slice(0, 8);
    const group = byPrefix.get(prefix);
    if (group === undefined) byPrefix.set(prefix, new Set([lower]));
    else group.add(lower);
  }
  const map = new Map();
  for (const [prefix, group] of byPrefix) {
    const originals = [...group].sort();
    const suffixes = originals.map((id) => digestHex(seed, 'id', id, 16)).sort();
    originals.forEach((id, index) => map.set(id, `${prefix}${suffixes[index]}`));
  }
  return map;
}

function collectIds(value, ids) {
  if (typeof value === 'string') {
    if (ID_RE.test(value)) ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectIds(entry, ids);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (ID_RE.test(key)) ids.add(key);
      collectIds(entry, ids);
    }
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One string, under one key. The rules run in this order and the first that applies wins:
 *
 *   1. a 24-hex id: the id map (relationships survive);
 *   2. a `#rrggbb` colour or an ISO 8601 date: kept;
 *   3. a key in `KEEP_KEYS`: kept (Trello's own vocabulary, `state`, `type`, ...);
 *   4. a URL: same scheme, same extension, `example.invalid` (under a URL key anything that
 *      parses counts; elsewhere only the well-known schemes do, so "Bug: fix login" stays text).
 *      This runs before the e-mail rule on purpose: `mailto:a@b.example`, a URL with userinfo
 *      and a URL with an `@` in its path all match the e-mail shape too, and rewriting one of
 *      them to a bare address would turn a URL into a non-URL and change what the importer
 *      makes of the attachment;
 *   5. an e-mail address: a hash at `example.invalid`;
 *   6. a numeric string: other digits, same count;
 *   7. `initials`, `username`, `avatarHash`, `shortLink`: same character class, same length;
 *   8. everything else: lorem text of the same shape (an attachment's `name` or `fileName` also
 *      keeps its file extension). If the key was not one this file knows to carry text, its
 *      path is recorded so the summary can show it.
 */
function anonymiseString(value, key, parentKey, path, context) {
  if (ID_RE.test(value)) return context.mapId(value);
  if (HEX_COLOR_RE.test(value) || ISO_DATE_RE.test(value)) return value;
  if (KEEP_KEYS.has(key)) return value;
  if (isUrlKey(key) || SPECIAL_SCHEME_RE.test(value)) {
    const url = pseudonymUrl(value, context.seed);
    if (url !== null) return url;
  }
  if (EMAIL_RE.test(value)) return pseudonymEmail(value, context.seed);
  if (NUMERIC_RE.test(value)) return pseudonymNumeric(value, context.seed);

  if (!TEXT_KEYS.has(key) && !TEXT_PARENT_KEYS.has(parentKey) && !isUrlKey(key)) {
    context.unrecognisedStringKeys.add(path);
  }
  switch (key) {
    case 'initials':
      return charsOfLength(value.length, UPPER, context.seed, key, value);
    case 'username':
      return charsOfLength(value.length, LOWER, context.seed, key, value);
    case 'avatarHash':
    case 'logoHash':
      return charsOfLength(value.length, HEX, context.seed, key, value);
    case 'shortLink':
      return charsOfLength(value.length, ALNUM, context.seed, key, value);
    default:
      return pseudonymText(value, context.seed, {
        keepExtension: isFileNameKey(key, parentKey),
      });
  }
}

function walk(value, key, parentKey, path, context) {
  if (typeof value === 'string') return anonymiseString(value, key, parentKey, path, context);
  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, key, parentKey, `${path}[]`, context));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [childKey, child] of Object.entries(value)) {
      const outKey = ID_RE.test(childKey) ? context.mapId(childKey) : childKey;
      const childPath = path === '' ? childKey : `${path}.${childKey}`;
      out[outKey] = walk(child, childKey, key, childPath, context);
    }
    return out;
  }
  return value;
}

function lengthOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

function sumOf(rows, pick) {
  return Array.isArray(rows)
    ? rows.reduce((total, row) => total + (isRecord(row) ? lengthOf(row[pick]) : 0), 0)
    : 0;
}

/** What the export contains, counted the way the import report counts it. */
export function summariseTrelloExport(board) {
  const lists = Array.isArray(board.lists) ? board.lists : [];
  const cards = Array.isArray(board.cards) ? board.cards : [];
  const actions = Array.isArray(board.actions) ? board.actions : [];
  return {
    lists: lists.length,
    archivedLists: lists.filter((list) => isRecord(list) && list.closed === true).length,
    cards: cards.length,
    archivedCards: cards.filter((card) => isRecord(card) && card.closed === true).length,
    labels: lengthOf(board.labels),
    checklists: lengthOf(board.checklists),
    checkItems: sumOf(board.checklists, 'checkItems'),
    attachments: sumOf(board.cards, 'attachments'),
    members: lengthOf(board.members),
    comments: actions.filter((action) => isRecord(action) && action.type === 'commentCard').length,
    customFields: lengthOf(board.customFields),
  };
}

/**
 * Anonymises one parsed Trello board export.
 *
 * Throws on anything that is not a board export by the same two-field test the importer's
 * reader uses (`parseTrelloExport`): a root object with a string `name` and an array `lists`.
 * Anything else would be anonymised into a file the importer refuses anyway.
 *
 * Returns the new export and a summary: the counts of what it contains, the top-level keys this
 * file did not recognise, the key paths whose strings were replaced by the text rule without the
 * key being known to carry text, and how many distinct ids were remapped.
 */
export function anonymiseTrelloExport(input, { seed = 'kurul' } = {}) {
  if (!isRecord(input) || typeof input.name !== 'string' || !Array.isArray(input.lists)) {
    throw new TypeError(
      'This does not look like a Trello board export: expected an object with a string "name" and an array "lists"',
    );
  }

  const ids = new Set();
  collectIds(input, ids);
  const idMap = buildIdMap(ids, seed);
  const context = {
    seed,
    unrecognisedStringKeys: new Set(),
    mapId: (id) => {
      const mapped = idMap.get(id.toLowerCase());
      if (mapped === undefined) throw new Error(`id ${id} was not collected before the walk`);
      return mapped;
    },
  };

  const output = walk(input, '', '', '', context);

  return {
    output,
    summary: {
      counts: summariseTrelloExport(input),
      unknownTopLevelKeys: Object.keys(input).filter((key) => !KNOWN_TOP_LEVEL_KEYS.has(key)),
      unrecognisedStringKeys: [...context.unrecognisedStringKeys].sort(),
      idsRemapped: idMap.size,
    },
  };
}
