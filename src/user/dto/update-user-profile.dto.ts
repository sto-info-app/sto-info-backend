import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpdateUserProfileDto {
  // populated server-side from the JWT bearer token
  userId: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'First name for the user profile.',
    example: 'Jean-Luc',
  })
  readonly firstName: string | null;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Last name for the user profile.',
    example: 'Picard',
  })
  readonly lastName: string | null;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @ApiProperty({
    description:
      'Public username shown in the app (minimum 5 characters). Must be unique (case-insensitive).',
    example: 'captain.picard',
    minLength: 5,
  })
  readonly username: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description:
      'Cloudflare Images id for the profile picture, if present. Typically set via the upload endpoint.',
    example: 'd3e2f1a0-b9c8-47d6-a5b4-3c2d1e0f9a8b',
  })
  profilePictureId: string | null;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Whether the user profile is publicly visible to other users.',
    example: true,
  })
  publiclyVisible: boolean;
}
