import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

import { STO_HANDLE_PATTERN } from 'src/shared/constants/regex-patterns.constants';

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

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateString()
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
