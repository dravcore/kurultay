import type {
  ColumnCategory,
  InvitationStatus,
  LabelColorSlot,
  MailDeliveryStatus,
  MemberRole,
  Priority,
} from './enums.js';
import type { Locale } from './locales.js';

/**
 * What this instance is configured to do — the answer to "is this feature switched on here",
 * asked by a client that cannot see the server's environment.
 *
 * Deployment capability, never tenant state: nothing in here varies by workspace, by role or
 * by caller, which is why it is served from a single account-level `GET /config` instead of
 * being repeated inside every workspace-scoped payload that happens to care.
 */
export interface InstanceConfigDto {
  /**
   * Whether outbound email has a transport that can actually deliver it.
   *
   * `false` means SMTP is unconfigured and every message is written to the API log instead —
   * so an invitee is never sent a link, cannot confirm their address, and therefore cannot
   * accept an invitation (`docs/decisions/0013-invitation-email-verification.md`). The web
   * app uses it to say so on the invite screen rather than letting an admin discover it from
   * a teammate who never got the email.
   */
  mailEnabled: boolean;
  /**
   * Whether this deployment stores attachments at all — i.e. whether `STORAGE_PATH` is set.
   *
   * A capability, like `mailEnabled`, never tenant state (`docs/api-conventions.md:175-177`).
   * The web reads it to decide whether to render the upload control. The *link* control does
   * not depend on it: a LINK needs no storage, so an instance with no `STORAGE_PATH` can still
   * attach links.
   */
  attachmentsEnabled: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /**
   * Chosen interface language as an IETF tag, or `null` for "never chose".
   *
   * `null` is a distinct state from `'en'`, not a missing value: an unset user follows their
   * browser's `Accept-Language`, so the web's resolution chain has to be able to tell the two
   * apart (docs/decisions/0018-localization-strategy.md).
   */
  locale: Locale | null;
  /**
   * Whether assignment, mention and due-soon notifications are also emailed. One switch for
   * every kind; `true` for a new account. Has no effect on an instance without SMTP
   * (`InstanceConfigDto.mailEnabled`).
   */
  emailNotifications: boolean;
  createdAt: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface WorkspaceMemberDto {
  id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  name: string;
  avatarUrl: string | null;
}

export interface InvitationDto {
  id: string;
  workspaceId: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  expiresAt: string;
  /** Computed client convenience URL — not a database column. */
  acceptUrl: string;
  /**
   * What happened to the invitation email, when the response is one this API watched being
   * sent — `POST /workspaces/:workspaceId/invitations` and nothing else.
   *
   * **Absent is not `SENT`.** A listed invitation is a stored row, and delivery is an event
   * that happened when it was created; nothing records it, so a list cannot honestly report
   * one. Omitting the field is the only reading of "we did not observe this" that a client
   * cannot mistake for a verdict — which is the whole point, because the verdict this field
   * exists to deliver is `NOT_CONFIGURED`, and inferring it wrongly is exactly the silent
   * failure it is here to end.
   */
  emailDelivery?: MailDeliveryStatus;
}

export interface BoardDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface ColumnDto {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  /**
   * Semantic state, independent of `name` and of position. Metrics key off this; a client
   * that wants to know whether a column means "finished" reads `category`, never the label
   * the user typed.
   */
  category: ColumnCategory;
  taskCount: number;
}

export interface ChecklistItemDto {
  id: string;
  content: string;
  isDone: boolean;
  position: number;
}

export interface ChecklistDto {
  id: string;
  title: string;
  position: number;
  items: ChecklistItemDto[];
}

/**
 * The board card's progress badge, carried on every task read.
 *
 * Counted at read time rather than stored: a denormalized counter drifts from its items the
 * first time a delete misses it, and the count is cheap next to the join that already fetches
 * the task. The board list reads items with the narrowest projection there is (`isDone` only)
 * so the badge costs a boolean per item, not a row — see `task.include.ts`.
 */
export interface ChecklistSummaryDto {
  total: number;
  done: number;
}

/**
 * Whether an attachment carries stored bytes or only points at a URL.
 *
 * A `const` object rather than a TS `enum`, matching every other enum in this package: the
 * values are the strings Prisma writes and the API sends, and a structural type keeps
 * `@kurul/shared-types` free of emitted runtime code the web bundle would have to carry.
 */
export const AttachmentKind = {
  File: 'FILE',
  Link: 'LINK',
} as const;

export type AttachmentKind = (typeof AttachmentKind)[keyof typeof AttachmentKind];

/**
 * The `error` field of the 413 an upload answers when a storage quota would be exceeded
 * (ADR 0027).
 *
 * The per-file size limit answers 413 too, so the status code alone cannot say which ceiling
 * was hit — and `docs/api-conventions.md#errors` tells clients to branch on `statusCode` and
 * `error`, never on `message`. This string is that branch, shared so the API that writes it and
 * the web that reads it cannot drift.
 */
export const ATTACHMENT_QUOTA_ERROR = 'Attachment Quota Exceeded';

/**
 * The `error` field of the 429 the upload route answers when a client IP has submitted more
 * bytes in the current minute than `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE` allows.
 *
 * The per-route request throttle answers 429 too, with the stock `"Too Many Requests"`; the
 * two ask for different waits (the budget's `Retry-After` is the rest of a fixed minute), and
 * clients branch on `statusCode` and `error`, never on `message`.
 */
export const UPLOAD_BUDGET_ERROR = 'Upload Budget Exceeded';

/**
 * One attachment on a task.
 *
 * The three FILE-only fields are `null` on a `LINK` and `url` is `null` on a `FILE`; `kind` is
 * what says which, and it is never inferred from the nulls (ADR 0024).
 *
 * There is deliberately no download URL in this DTO. The client builds it from `id` — the
 * endpoint is published in ADR 0022, and a server-rendered absolute URL would bake the
 * deployment's origin into a payload that the same-origin image goes out of its way not to
 * carry (`apps/web/lib/api-url.ts`).
 */
export interface AttachmentDto {
  id: string;
  taskId: string;
  kind: AttachmentKind;
  /** Display name. For a FILE this is what the browser sent; it never appears in a path. */
  filename: string;
  /** FILE only: the sniffed media type, never the one the client declared. */
  mimeType: string | null;
  /** FILE only: bytes. */
  size: number | null;
  /** LINK only: an `http:`/`https:` URL the server has never requested and never will. */
  url: string | null;
  uploadedById: string;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  position: number;
  dueDate: string | null;
  estimatedMinutes: number | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  assignees: TaskAssigneeDto[];
  labels: LabelDto[];
  checklistSummary: ChecklistSummaryDto;
  /** Full checklists on a single-task read; `null` on list reads, where only the summary is loaded. */
  checklists: ChecklistDto[] | null;
  /**
   * How many attachments the task has, on every task read.
   *
   * A count and not a list, unlike `checklists`: the card needs the number and the panel reads
   * the full list from its own endpoint. Loading attachment rows into the board list would hand
   * back what P2-8 bought, and unlike a checklist there is no badge that needs their contents.
   */
  attachmentCount: number;
}

export interface TaskAssigneeDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface LabelDto {
  id: string;
  boardId: string;
  name: string;
  color: LabelColorSlot;
}

export interface CommentDto {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  createdAt: string;
  /**
   * Who wrote it, resolved so the client never has to join a roster it may not be able to read.
   *
   * `deleted` is the whole of what an anonymised account exposes here, and the field is a
   * **boolean rather than the `deletedAt` timestamp on purpose**. This object is returned by a
   * `@WorkspaceScoped()` route, so every member down to GUEST reads it, and
   * `docs/architecture.md`'s rule is that a payload must never widen who can see something —
   * *when* a named individual asked to be erased is a fact about that person which nothing on
   * this screen needs. The boolean is enough for everything a client legitimately does with it:
   * render a localised "deleted user" label instead of the stored English one, and decline to
   * offer affordances that only make sense for a live member (a profile link, a mention entry).
   *
   * `name` still carries `Deleted user` for a tombstone, because an API consumer that is not
   * this web app still needs something readable in the field
   * (docs/decisions/0026-account-deletion-anonymisation.md).
   */
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    /** True when this account has been anonymised — see the note above. */
    deleted: boolean;
  };
}

export interface ActivityDto {
  id: string;
  workspaceId: string;
  taskId: string | null;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Who did it. Same shape and same `deleted` contract as {@link CommentDto.author}. */
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    deleted: boolean;
  };
}

export interface NotificationDto {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  taskId: string | null;
  activityId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationUnreadCountDto {
  count: number;
}

/**
 * Which part of a Trello export a skipped item came from.
 *
 * `list` and `column` are both here and they are not the same thing: `list` names something the
 * reader found in the export and did not carry across, `column` names something that *was*
 * carried across and arrived changed — the default category every imported column takes
 * (docs/decisions/0025-trello-import-mapping.md). A report that used one word for both would
 * have to make the user work out which of the two happened.
 */
export const TrelloImportScope = {
  List: 'list',
  Column: 'column',
  Card: 'card',
  Label: 'label',
  Checklist: 'checklist',
  ChecklistItem: 'checklistItem',
  Attachment: 'attachment',
  Member: 'member',
  Comment: 'comment',
} as const;

export type TrelloImportScope = (typeof TrelloImportScope)[keyof typeof TrelloImportScope];

/**
 * Why an item did not make it across.
 *
 * A closed vocabulary rather than free text, because the web renders one sentence per reason
 * (`app.board.import.skip.*` in `messages/en.json`) and a free-text reason would either ship
 * English into a Turkish UI or force the API to know the reader's language — the line ADR 0018
 * draws. Adding a reason costs a translation key, which is the cost that keeps the list honest.
 */
export const TrelloImportSkipReason = {
  /** Kurul has no equivalent for this at all — comments today (ADR 0025). */
  OutOfScope: 'outOfScope',
  /** Trello had it archived (`closed: true`) and Kurul has no archive (ADR 0025). */
  Archived: 'archived',
  /** A Trello member; nothing in Kurul to map them onto (ADR 0025). */
  Unmappable: 'unmappable',
  /** An attachment URL that is neither `http:` nor `https:` (ADR 0024, ADR 0025). */
  UnsupportedScheme: 'unsupportedScheme',
  /**
   * Present but unusable: a card with no name, a checklist with no items — and, because no field
   * name in the importer was ever verified against a real Trello export, anything whose shape the
   * reader did not recognise. That second case is the reason the reader answers with a report
   * instead of an error: a schema drift should cost the user the drifted rows, not the import.
   */
  Malformed: 'malformed',
  /**
   * Not a skip at all — a *substitution*, reported in the same list because the user needs to
   * know it happened. An unknown Trello colour fell back to `slot-1`, and every imported column
   * took the default category.
   *
   * Putting a substitution in a list called "skipped" is deliberate. A separate `substitutions`
   * array was considered and rejected: the question a user asks after an import is not "what did
   * I lose", it is "why does my board look different", and two lists would force them to read
   * both to answer it.
   */
  Defaulted: 'defaulted',
} as const;

export type TrelloImportSkipReason =
  (typeof TrelloImportSkipReason)[keyof typeof TrelloImportSkipReason];

/** One `(scope, reason)` pair of a Trello import report, with a count and a few examples. */
export interface TrelloImportSkipGroupDto {
  scope: TrelloImportScope;
  reason: TrelloImportSkipReason;
  /** The real number. Never capped. */
  count: number;
  /**
   * Up to 20 names, for a user trying to recognise what is missing.
   *
   * Capped where the report is built, not here: a 500-card import can produce 500 skipped cards,
   * and an uncapped list would make the response scale with the export instead of with the
   * number of *kinds* of problem — which is the only thing a person can act on.
   */
  samples: string[];
}

/**
 * The body of a successful Trello import — `201 Created`.
 *
 * This is the whole report and it is not stored anywhere. A user who closes it has lost the list
 * of what did not come across; the board is unaffected (ADR 0025).
 */
export interface TrelloImportReportDto {
  boardId: string;
  boardName: string;
  /** Rows actually written. */
  imported: {
    columns: number;
    tasks: number;
    labels: number;
    checklists: number;
    checklistItems: number;
    attachments: number;
  };
  /** Everything not written, grouped by `(scope, reason)`. */
  skipped: TrelloImportSkipGroupDto[];
}

/** Default list pagination shape (keyed on `id`, never `position`). */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore?: boolean;
}

export interface DashboardCountByPriority {
  priority: Priority;
  count: number;
}

/**
 * One bar of the workload-by-assignee chart.
 *
 * **`count` is assignments, not tasks.** A task with three assignees contributes one to each
 * of them, so `Σ byAssignee` deliberately exceeds `totalTasks` on any board that uses
 * multiple assignees. That is the intended reading, not a discrepancy to reconcile: the
 * chart answers "how much is on each person's plate", and attributing a shared task to
 * exactly one of its assignees would have to pick a winner arbitrarily and under-report
 * everyone else. `Unassigned` is the exception and is a task count, because a task with
 * nobody on it has no assignment row to aggregate.
 *
 * The reasoning lives in full on `DashboardService.rankedAssigneeBuckets`; it is repeated
 * here because a consumer reading only this package would otherwise see two totals that do
 * not add up and treat one of them as a bug.
 */
export interface DashboardCountByAssignee {
  /** `null` for Unassigned or Other aggregate buckets. */
  userId: string | null;
  name: string;
  count: number;
}

export interface DashboardCountByColumn {
  columnId: string;
  name: string;
  position: number;
  count: number;
}

/** One UTC calendar day in the created-vs-completed series. */
export interface DashboardThroughputDay {
  /** ISO date `YYYY-MM-DD` (UTC). */
  date: string;
  created: number;
  completed: number;
}

/** Workspace (or board-scoped) dashboard aggregates — Phase 7. */
export interface DashboardSummaryDto {
  totalTasks: number;
  overdueCount: number;
  byPriority: DashboardCountByPriority[];
  byAssignee: DashboardCountByAssignee[];
  /** Present only when `boardId` query is set. */
  byColumn: DashboardCountByColumn[] | null;
  /** Last 14 UTC days: `task.created` vs moves into a `COMPLETED` column. */
  throughput: DashboardThroughputDay[];
}

/**
 * What deleting this account is about to do, answered before anything is destroyed.
 *
 * The preview exists because one of the questions an erasure request raises has no safe
 * default. A workspace the user is the only OWNER of cannot be left behind, and it cannot be
 * guessed at either — transferring hands a tenant to someone who never asked for it, deleting
 * takes other people's boards with it. So the client is handed the facts and the API refuses to
 * proceed until it is handed a decision back
 * (docs/decisions/0026-account-deletion-anonymisation.md).
 */
export interface AccountDeletionPreviewDto {
  /** The account this preview describes — the caller, or an administrator's target. */
  userId: string;
  /**
   * Workspaces the user is the **only** OWNER of. Each one needs a disposition in the delete
   * request, or it is refused with `409`.
   */
  soleOwnedWorkspaces: SoleOwnedWorkspaceDto[];
  /**
   * Workspaces the user is in that need no decision — another OWNER is present, or the user
   * holds a lesser role. Their membership is simply removed.
   *
   * Listed rather than counted because "you will be removed from these five workspaces" is the
   * other half of what the person is agreeing to, and a number does not say which.
   */
  otherWorkspaces: DepartingMembershipDto[];
  /**
   * What stays behind, re-attributed to a row that no longer names anybody.
   *
   * Counts and not contents: the point of showing them is that the user learns their comments
   * do not disappear, not that they re-read them here.
   */
  retainedContent: RetainedContentDto;
}

/** A workspace whose only OWNER is the departing user. */
export interface SoleOwnedWorkspaceDto {
  workspaceId: string;
  name: string;
  slug: string;
  memberCount: number;
  boardCount: number;
  /**
   * Members who could be promoted to OWNER in the departing user's place.
   *
   * **Empty means transfer is impossible**, not that the client should offer it and let the
   * server refuse: a workspace whose only member is the person leaving has nobody to hand it
   * to, and deleting is the only disposition the endpoint will accept for it.
   */
  transferCandidates: TransferCandidateDto[];
}

/** A member who may be promoted to OWNER when the current sole owner leaves. */
export interface TransferCandidateDto {
  userId: string;
  name: string;
  role: MemberRole;
}

/** A membership that will be removed without a decision being needed. */
export interface DepartingMembershipDto {
  workspaceId: string;
  name: string;
  role: MemberRole;
}

/** Rows that survive the deletion, re-attributed to an anonymised `User` row. */
export interface RetainedContentDto {
  comments: number;
  tasksCreated: number;
  attachments: number;
  activities: number;
}
