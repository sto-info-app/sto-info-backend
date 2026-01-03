import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateAccountRequestDto {
  @IsNotEmpty()
  @IsString()
  readonly handle: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly username: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsEmail()
  readonly email: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  readonly notes: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateString()
  readonly accountCreatedDate: string;

  @IsOptional()
  @IsBoolean()
  readonly publiclyVisible: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  readonly platformId: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  readonly launcherId: string;
}
