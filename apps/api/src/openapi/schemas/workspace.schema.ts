import type {
  CursorPage,
  InvitationDto,
  InvitationStatus,
  Locale,
  MailDeliveryStatus,
  MemberRole,
  UserDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@kurul/shared-types';

/** The caller's own account. */
export class UserSchema implements UserDto {
  id!: string;
  email!: string;
  name!: string;
  avatarUrl!: string | null;
  /**
   * Chosen interface language as an IETF tag, or `null` for "never chose".
   *
   * `null` is a distinct state from `"en"`: an unset user follows their browser's
   * `Accept-Language`.
   */
  locale!: Locale | null;
  /**
   * Whether assignment, mention and due-soon notifications are also sent by email. One switch
   * for every kind. Has no effect while `InstanceConfigDto.mailEnabled` is `false`.
   */
  emailNotifications!: boolean;
  /** ISO 8601 UTC. */
  createdAt!: string;
}

/** A workspace — the tenant root every resource-bearing route hangs off. */
export class WorkspaceSchema implements WorkspaceDto {
  id!: string;
  name!: string;
  /** Lowercase alphanumeric with optional hyphens. Unique across the instance. */
  slug!: string;
  createdAt!: string;
}

/** One person's membership of one workspace. */
export class WorkspaceMemberSchema implements WorkspaceMemberDto {
  id!: string;
  workspaceId!: string;
  userId!: string;
  role!: MemberRole;
  name!: string;
  avatarUrl!: string | null;
}

/** A pending or resolved invitation to a workspace. */
export class InvitationSchema implements InvitationDto {
  id!: string;
  workspaceId!: string;
  email!: string;
  role!: MemberRole;
  status!: InvitationStatus;
  expiresAt!: string;
  /** Computed convenience URL for the client. Not a stored column. */
  acceptUrl!: string;
  /**
   * What became of the invitation email — on `POST .../invitations` and nowhere else.
   *
   * **Absent is not `SENT`.** It means this API observed no send for the request. A listed
   * invitation is a stored row while delivery is an event nothing records, so
   * `GET .../invitations` never carries the field.
   */
  emailDelivery?: MailDeliveryStatus;
}

/** One page of the workspace roster. */
export class WorkspaceMemberPageSchema implements CursorPage<WorkspaceMemberDto> {
  items!: WorkspaceMemberSchema[];
  /** Pass as `?cursor=` to fetch the next page. `null` on the last page. */
  nextCursor!: string | null;
  hasMore!: boolean;
}

/** One page of pending invitations. */
export class InvitationPageSchema implements CursorPage<InvitationDto> {
  items!: InvitationSchema[];
  nextCursor!: string | null;
  hasMore!: boolean;
}
