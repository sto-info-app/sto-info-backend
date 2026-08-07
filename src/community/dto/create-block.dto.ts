import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Blocks a member by profile username.
 */
export class CreateBlockDto {
  @ApiProperty({
    description: 'The profile username of the member to block.',
    example: 'captain.picard',
    maxLength: 50,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  readonly username: string;

  @ApiPropertyOptional({
    description:
      'A private note for the blocker. Never shown to the blocked member.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  readonly reason?: string;
}
