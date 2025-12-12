import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class UpdateUserProfileDto {
  @IsNotEmpty()
  @IsUUID()
  userId: string;

  @IsNotEmpty()
  @IsString()
  readonly firstName: string;

  @IsNotEmpty()
  @IsString()
  readonly lastName: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  readonly username: string;

  @IsOptional()
  @IsString()
  profilePictureId: string;

  @IsOptional()
  @IsBoolean()
  publiclyVisible: boolean;
}
