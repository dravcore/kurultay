import { IsBoolean, IsIn } from 'class-validator';
import { SUPPORTED_LOCALES, type Locale } from '@kurul/shared-types';
import { OptionalNonNullable, OptionalNullable } from '../../common/validation/optional';

export class UpdateMeDto {
  /**
   * Nullable on purpose: clearing the preference puts the user back on their browser's
   * `Accept-Language`, which a user who set a language on someone else's machine should be
   * able to undo. Omitting the key leaves the stored value alone.
   *
   * Validated against `SUPPORTED_LOCALES` rather than a loose IETF-tag pattern, so the column
   * can only ever hold a tag the app actually ships a catalog for.
   */
  @OptionalNullable()
  @IsIn(SUPPORTED_LOCALES)
  locale?: Locale | null;

  /**
   * Not nullable: the column has a default and "no preference" is not a state it can hold.
   * Omitting the key leaves the stored value alone.
   */
  @OptionalNonNullable()
  @IsBoolean()
  emailNotifications?: boolean;
}
