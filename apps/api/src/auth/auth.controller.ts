import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UserDto } from '@kurul/shared-types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import type { AuthenticatedUser } from '../common/types/request-context';
import { UserSchema } from '../openapi/schemas/workspace.schema';
import { AuthService } from './auth.service';
import { UpdateMeDto } from './dto/update-me.dto';

@ApiTags('Account')
@Controller()
@UseGuards(SessionAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: "Read the caller's own profile",
    description:
      'Sign-in, sign-up and sign-out are Better Auth routes under `/auth/*`, which is mounted ' +
      'below the Nest router and is therefore not described in this document.',
  })
  @ApiOkResponse({ type: UserSchema })
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    return this.authService.me(user);
  }

  /**
   * The user's own profile. Not workspace-scoped and deliberately not role-gated: the subject
   * is the caller, so `SessionAuthGuard` is the whole authorization story.
   */
  @ApiOperation({
    summary: "Update the caller's own profile",
    description:
      'Not workspace-scoped and deliberately not role-gated: the subject is the caller, so the ' +
      'session guard is the whole authorization story. Two fields: the interface language, ' +
      'where `null` is a distinct state from `"en"` (it means "follow the browser"), and ' +
      '`emailNotifications`, the per-user switch for notification email.',
  })
  @ApiOkResponse({ type: UserSchema })
  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto): Promise<UserDto> {
    return this.authService.updateMe(user, dto);
  }
}
