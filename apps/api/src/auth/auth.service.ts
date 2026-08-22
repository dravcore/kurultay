import { Injectable } from '@nestjs/common';
import { matchLocale, type Locale, type UserDto } from '@kurul/shared-types';
import { LocaleService } from '../locale/locale.service';
import { assertAccountNotDeleted } from '../common/deleted-account';
import type { AuthenticatedUser } from '../common/types/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateMeDto } from './dto/update-me.dto';

/** The columns of `User` a person edits about themselves, as `GET /me` reports them. */
export interface UserPreferences {
  locale: Locale | null;
  emailNotifications: boolean;
}

const DEFAULT_PREFERENCES: UserPreferences = { locale: null, emailNotifications: true };

@Injectable()
export class AuthService {
  constructor(
    private readonly localeService: LocaleService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The signed-in user as the web sees them.
   *
   * The preferences cost a primary-key lookup rather than riding along on the session, because
   * the session user is cached in a cookie for 60 seconds and this endpoint is what the web's
   * locale resolution chain reads — a stale value here means the interface does not change
   * language until the cache expires. See `LocaleService`.
   */
  async me(user: AuthenticatedUser): Promise<UserDto> {
    return this.toUserDto(user, await this.readPreferences(user.id));
  }

  /**
   * Applies a profile patch and answers with the user in its post-write state.
   *
   * One of the two writes in the API that are not workspace-scoped, so one of the two that has
   * to refuse a session belonging to an account already deleted — writing a locale onto a
   * tombstone would undo part of the anonymisation. See `common/deleted-account.ts` for why the
   * check lives here rather than in `SessionAuthGuard`.
   */
  async updateMe(user: AuthenticatedUser, dto: UpdateMeDto): Promise<UserDto> {
    // `undefined` means the client did not mention the field; `null` means "clear it". Only
    // the former leaves the stored value alone — and only the latter reaches the database, so
    // the deleted-account check goes with the write and not with the no-op read.
    if (dto.locale === undefined && dto.emailNotifications === undefined) {
      return this.me(user);
    }
    await assertAccountNotDeleted(this.prisma, user.id);

    if (dto.locale !== undefined) {
      await this.localeService.write(user.id, dto.locale);
    }
    if (dto.emailNotifications !== undefined) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailNotifications: dto.emailNotifications },
        select: { id: true },
      });
    }
    return this.me(user);
  }

  /**
   * Both preferences in one read. `locale` goes through `matchLocale` for the reason
   * `LocaleService.read` gives: a stored tag the app no longer ships must read as "never chose".
   */
  private async readPreferences(userId: string): Promise<UserPreferences> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true, emailNotifications: true },
    });
    if (!row) return DEFAULT_PREFERENCES;
    return { locale: matchLocale(row.locale), emailNotifications: row.emailNotifications };
  }

  toUserDto(user: AuthenticatedUser, preferences: UserPreferences): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      locale: preferences.locale,
      emailNotifications: preferences.emailNotifications,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
