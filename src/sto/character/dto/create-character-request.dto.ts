import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  Validate,
} from 'class-validator';

import { CHARACTER_NAME_PATTERN } from 'src/shared/constants/regex-patterns.constants';
import { IsCalendarDateConstraint } from 'src/shared/utilities/is-calendar-date.constraint';

export const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateCharacterRequestDto {
  @IsNotEmpty()
  @IsUUID()
  readonly accountId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(CHARACTER_NAME_PATTERN, {
    message:
      'Character handle can only consist of letters, single quotes, spaces, full stops, and hyphens, and cannot end with a space.',
  })
  readonly handle: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly profilePictureId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  readonly level?: number;

  @IsNotEmpty()
  @IsUUID()
  readonly generalFactionId: string;

  @IsNotEmpty()
  @IsUUID()
  readonly factionId: string;

  @IsNotEmpty()
  @IsUUID()
  readonly sexId: string;

  @IsNotEmpty()
  @IsUUID()
  readonly classId: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  readonly recruitTypeId?: string;

  @IsNotEmpty()
  @IsUUID()
  readonly speciesId: string;

  /**
   * The day the captain was created, as `YYYY-MM-DD`.
   *
   * A calendar date rather than an instant, for the same reason as the
   * account's: an offset makes the day ambiguous, and picking one silently is
   * worse than asking.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Validate(IsCalendarDateConstraint)
  readonly createdDate?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly firstName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly middleName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly lastName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly biography?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly notes?: string;

  @IsOptional()
  @IsBoolean()
  readonly publiclyVisible?: boolean;
}
