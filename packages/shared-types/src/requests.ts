/**
 * Request bodies accepted by the Nest API, as the client sees them.
 *
 * Manually mirrors the `class-validator` DTOs under each `apps/api/src` feature module's
 * `dto` folder — same rule as `enums.ts` mirroring the Prisma schema. Length, format and
 * enum constraints stay on the server; these types only describe shape and nullability, so
 * a client cannot send a field the endpoint would reject outright.
 *
 * An optional property means "omit to leave unchanged / fall back to the server default".
 * An explicit `null` means "clear this value" and is only allowed where the DTO accepts it.
 *
 * Only the endpoints the web client actually calls are mirrored here. A shape nothing imports
 * buys no type safety and silently drifts from the DTO it claims to mirror, so the entry is
 * added with the first caller — `PATCH /labels/:labelId` and `PATCH /workspaces/:workspaceId`
 * exist on the server but have no UI yet.
 */
import type { AttachmentKind } from './entities.js';
import type { ColumnCategory, LabelColorSlot, MemberRole, Priority } from './enums.js';
import type { Locale } from './locales.js';

/**
 * `PATCH /me`
 *
 * The signed-in user's own profile. Only the interface language is editable today; name,
 * email and avatar still go through Better Auth's own endpoints.
 */
export interface UpdateMeRequest {
  /**
   * Omit to leave unchanged. An explicit `null` clears the preference back to "follow the
   * browser's `Accept-Language`", which is a real choice and not the same as picking English.
   */
  locale?: Locale | null;
  /** Omit to leave unchanged. `false` stops notification email; in-app notifications stay. */
  emailNotifications?: boolean;
}

/** `POST /workspaces/:workspaceId/boards/:boardId/tasks` */
export interface CreateTaskRequest {
  title: string;
  columnId: string;
  description?: string | null;
  /** Omit to fall back to the server default (`Priority.MEDIUM`). */
  priority?: Priority;
  dueDate?: string | null;
  /** Effort, never a deadline — kept separate from `dueDate`. */
  estimatedMinutes?: number | null;
  /** Insert after this task in the target column; omit to append. */
  afterTaskId?: string | null;
}

/** `PATCH /workspaces/:workspaceId/tasks/:taskId` */
export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
}

/**
 * `PATCH /workspaces/:workspaceId/tasks/:taskId/position`
 *
 * Neighbors, never a position: the server owns the Float it lands on.
 */
export interface MoveTaskRequest {
  columnId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/assignees` */
export interface AddAssigneeRequest {
  userId: string;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/labels` */
export interface AddTaskLabelRequest {
  labelId: string;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/checklists` */
export interface CreateChecklistRequest {
  title: string;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/checklists/:checklistId/items` */
export interface CreateChecklistItemRequest {
  content: string;
}

/**
 * `PATCH /workspaces/:workspaceId/tasks/:taskId/checklist-items/:itemId`
 *
 * Both fields optional because the two edits are independent: ticking a box must not resend
 * the content, and renaming an item must not restate whether it is done. An empty body is
 * accepted by the server and deliberately writes nothing.
 */
export interface UpdateChecklistItemRequest {
  content?: string;
  isDone?: boolean;
}

/**
 * `POST /workspaces/:workspaceId/tasks/:taskId/attachments`, JSON shape only.
 *
 * The same endpoint also takes `multipart/form-data` for a FILE (plan decision D7), and that
 * shape has no type here on purpose: a `FormData` carries no compile-time contract, which is
 * why `api.postForm` is a separate member from `api.post`. This interface mirrors the JSON
 * branch — `kind: 'LINK'` — where `CreateAttachmentDto` requires a non-empty `url`.
 *
 * The scheme allowlist (`http:`/`https:` and nothing else) lives on the server and is not
 * expressible here; the client never treats its own check as the one that matters (K7).
 */
export interface CreateAttachmentLinkRequest {
  kind: Extract<AttachmentKind, 'LINK'>;
  url: string;
  /** Display name. Omit and the server shows the URL itself. */
  filename?: string;
}

/** `POST /workspaces/:workspaceId/boards` */
export interface CreateBoardRequest {
  name: string;
  description?: string | null;
}

/** `PATCH /workspaces/:workspaceId/boards/:boardId` */
export interface UpdateBoardRequest {
  name?: string;
  description?: string | null;
}

/** `POST /workspaces/:workspaceId/boards/:boardId/columns` */
export interface CreateColumnRequest {
  name: string;
  /** Insert after this column; omit to append. */
  afterColumnId?: string | null;
  color?: string;
  /** Omit to fall back to the server default (`ColumnCategory.UNSTARTED`). */
  category?: ColumnCategory;
}

/** `PATCH /workspaces/:workspaceId/columns/:columnId` */
export interface UpdateColumnRequest {
  name?: string;
  color?: string | null;
  category?: ColumnCategory;
}

/** `PATCH /workspaces/:workspaceId/columns/:columnId/position` */
export interface MoveColumnRequest {
  beforeColumnId?: string | null;
  afterColumnId?: string | null;
}

/** `POST /workspaces/:workspaceId/tasks/:taskId/comments` */
export interface CreateCommentRequest {
  body: string;
}

/** `POST /workspaces/:workspaceId/boards/:boardId/labels` */
export interface CreateLabelRequest {
  name: string;
  /** Design-token slot, never a raw hex value. */
  color: LabelColorSlot;
}

/** `POST /workspaces` */
export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
}

/**
 * `PATCH /workspaces/:workspaceId`
 *
 * Both fields are independently optional because `UpdateWorkspaceDto`
 * (apps/api/src/workspace/dto/update-workspace.dto.ts) treats `slug` as a value someone chooses
 * on purpose, not something re-derived from a new `name` — renaming a workspace never moves its
 * slug out from under it. The web client only ever sends `name`: nothing in `apps/web` resolves
 * a route or a link by slug, so there is no product surface to build a slug editor for yet.
 */
export interface UpdateWorkspaceRequest {
  name?: string;
  slug?: string;
}

/**
 * `POST /workspaces/:workspaceId/invitations`
 *
 * `role` stays the full `MemberRole` union even though `CreateInvitationDto` rejects `OWNER`
 * outright (`@IsNotIn`): ownership is handed to someone who is already a member, never mailed
 * to an address that has not accepted anything yet. Narrowing it here would move that rule
 * into the type system, where the client could no longer see — or explain — the `400` the
 * server answers with. Same division as everywhere else in this file: shape here, constraints
 * on the server.
 */
export interface CreateInvitationRequest {
  email: string;
  role: MemberRole;
}

/**
 * `PATCH /workspaces/:workspaceId/members/:userId/role`
 *
 * `OWNER` *is* reachable here — promotion is how ownership is transferred — but only for a
 * caller who is already an OWNER, which is a question about the caller and not about the
 * body, so it is answered by `WorkspaceMemberService` with a `403`.
 */
export interface UpdateMemberRoleRequest {
  role: MemberRole;
}

/**
 * What is to become of one workspace the departing user is the only OWNER of.
 *
 * A discriminated union rather than an optional `newOwnerUserId`, because the two shapes are
 * two different decisions and a body that carries both — or neither — is not a decision at all.
 * See `docs/decisions/0026-account-deletion-anonymisation.md`.
 */
export type WorkspaceDispositionRequest =
  | { workspaceId: string; action: 'transfer'; newOwnerUserId: string }
  | { workspaceId: string; action: 'delete' };

/**
 * `DELETE /me` and `DELETE /instance/users/:userId`
 *
 * `confirmEmail` must equal the address of the account being deleted, and it is a misclick
 * gate rather than a security control — the session sending this request can already delete
 * every workspace the user owns, so a stronger check here alone would imply a guarantee it
 * does not give (ADR 0026 §4).
 *
 * `dispositions` must name every workspace `GET …/deletion-preview` returned under
 * `soleOwnedWorkspaces`, exactly once. Missing, unknown or duplicated entries are `409`, and
 * there is deliberately no default for either direction.
 */
export interface DeleteAccountRequest {
  confirmEmail: string;
  dispositions?: WorkspaceDispositionRequest[];
}
