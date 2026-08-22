import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_LOCALE, matchLocale, negotiateLocale, type Locale } from '@kurul/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reads and writes the interface language, and resolves which one applies to a request.
 *
 * The API stays free of interface translation (ADR 0018 §2) — it returns error codes and the
 * web owns the catalog. This service exists for the two exceptions the ADR carves out: content
 * the API writes into the database on the user's behalf (a board's seed columns) and outbound
 * email, both of which have to be in a specific person's language.
 *
 * `User.locale` is read from the database rather than from the session, on purpose. Better
 * Auth caches the session user in a signed cookie for 60 seconds (`session.cookieCache`), so
 * a locale carried on the session would keep reporting the old language for up to 60 seconds
 * after the user changed it — and `GET /me` is what the web's resolution chain consults, so
 * the interface would simply not change until the cache expired. A primary-key lookup is the
 * price of the preference being correct the moment it is saved.
 */
@Injectable()
export class LocaleService {
  private readonly logger = new Logger(LocaleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The user's stored preference, or `null` when they never chose one.
   *
   * A stored tag that is no longer in `SUPPORTED_LOCALES` reads as `null`: dropping a language
   * must leave those users falling through the rest of the chain, not pinned to a catalog that
   * no longer exists.
   */
  async read(userId: string): Promise<Locale | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return matchLocale(row?.locale);
  }

  /** Stores the preference; `null` clears it back to "follow the browser". */
  async write(userId: string, locale: Locale | null): Promise<Locale | null> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: { locale },
      select: { locale: true },
    });
    return matchLocale(row.locale);
  }

  /**
   * `User.locale` → `Accept-Language` → `'en'`.
   *
   * The API's half of the chain in ADR 0018. There is no cookie link here: the cookie is the
   * web's mirror of the same preference for renders that cannot wait on a database read, and
   * the API already has the authoritative value.
   *
   * Never rejects. A failed preference read degrades to the header rather than failing the
   * request that needed it — seeding a board in the wrong language is recoverable by renaming
   * a column; not creating the board is not.
   */
  async resolve(userId: string | null, acceptLanguage?: string | null): Promise<Locale> {
    const stored = userId === null ? null : await this.readQuietly(userId);
    return stored ?? negotiateLocale(acceptLanguage) ?? DEFAULT_LOCALE;
  }

  private async readQuietly(userId: string): Promise<Locale | null> {
    try {
      return await this.read(userId);
    } catch (caught) {
      this.logger.warn(
        `Falling back to Accept-Language: could not read locale for user ${userId}`,
        caught instanceof Error ? caught.stack : undefined,
      );
      return null;
    }
  }
}
