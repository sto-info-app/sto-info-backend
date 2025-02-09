import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAccountDto {
  @IsNotEmpty()
  @IsString()
  readonly handle: string;

  @IsOptional()
  @IsString()
  readonly username: string;

  @IsOptional()
  @IsEmail()
  readonly email: string;

  @IsOptional()
  @IsString()
  readonly notes: string;

  @IsOptional()
  @IsDateString()
  readonly accountCreatedDate: string;

  @IsOptional()
  @IsBoolean()
  readonly publiclyVisible: boolean;

  @IsNotEmpty()
  @IsUUID()
  readonly platformId: string;

  @IsNotEmpty()
  @IsUUID()
  readonly launcherId: string;

  @IsNotEmpty()
  @IsUUID()
  readonly userId: string;
}
