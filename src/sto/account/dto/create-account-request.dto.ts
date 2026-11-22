import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Validate,
} from 'class-validator';

import { STO_HANDLE_PATTERN } from 'src/shared/constants/regex-patterns.constants';
import { IsCalendarDateConstraint } from 'src/shared/utilities/is-calendar-date.constraint';

const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateAccountRequestDto {
  @IsNotEmpty()
  @IsString()
  @Matches(STO_HANDLE_PATTERN, {
    message:
      'Account handle must be 3-16 characters long, start with a letter, and contain only letters, numbers, full stops, underscores, or hyphens. It may optionally end with a hash and 4+ digits.',
  })
  readonly handle: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly username?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsEmail()
  readonly email?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly notes?: string;

  /**
   * The day the STO account was created, as `YYYY-MM-DD`.
   *
   * A calendar date rather than an instant. `@IsDateString` would also accept
   * `2015-03-04T23:00:00-05:00`, which is the fourth of March in New York and
   * the fifth in UTC — so storing it would mean choosing one and silently
   * discarding the other. Refusing it asks the client to say which day it
   * means instead.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Validate(IsCalendarDateConstraint)
  readonly accountCreatedDate?: string;

  @IsOptional()
  @IsBoolean()
  readonly publiclyVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  readonly lifetimeSubscription?: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  readonly platformId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  readonly launcherId?: string;
}
