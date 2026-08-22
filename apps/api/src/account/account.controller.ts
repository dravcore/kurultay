import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AccountDeletionPreviewDto } from '@kurul/shared-types';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import type { AuthenticatedUser } from '../common/types/request-context';
import { sessionCookieNames } from '../auth/session-cookie-names';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';

/**
 * The signed-in user's own account, and the one irreversible thing that can be done to it.
 *
 * Not workspace-scoped and deliberately not role-gated, for the same reason `PATCH /me` is
 * not: the subject is the caller, so `SessionAuthGuard` is the whole authorization story. The
 * decisions this endpoint refuses to make on the caller's behalf are in
 * `docs/decisions/0026-account-deletion-anonymisation.md`.
 */
@Controller('me')
@UseGuards(SessionAuthGuard)
export class AccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  /**
   * What deleting this account would do, before any of it happens.
   *
   * A separate `GET` rather than a field on `/me`: it runs six counts and a per-workspace
   * roster read, and `/me` is on the web's locale-resolution path — it is polled, this is
   * opened once by somebody who has decided to read it.
   */
  @Get('deletion-preview')
  preview(@CurrentUser() user: AuthenticatedUser): Promise<AccountDeletionPreviewDto> {
    return this.deletion.preview(user.id);
  }

  /**
   * Deletes the caller's account: `204`, and the session it was sent with is over.
   *
   * The cookies are cleared on the way out because Better Auth's `session.cookieCache` answers
   * from a signed cookie for up to 60 seconds without consulting the database, so deleting
   * the `Session` rows does not by itself stop this browser presenting a valid session. Clearing
   * them here closes that window for the browser that asked — which is every browser on this
   * path (ADR 0026 §"Consequences" covers the administrator path, where it cannot be closed).
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.deletion.deleteAccount(user.id, dto, 'self', null);

    // Named rather than enumerated from the request: only Better Auth's own cookies are
    // cleared, and clearing one this API did not set is not this endpoint's business.
    // `path: '/'` matches what Better Auth sets — without it the browser keeps the original
    // alongside the expired one and nothing changes.
    for (const name of sessionCookieNames()) {
      response.clearCookie(name, { path: '/' });
    }
  }
}
