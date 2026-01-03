import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export const emptyStringToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CreateCharacterRequestDto {
  @IsNotEmpty()
  @IsUUID()
  readonly accountId: string;

  @IsNotEmpty()
  @IsString()
  readonly name: string;

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

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateString()
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
}
