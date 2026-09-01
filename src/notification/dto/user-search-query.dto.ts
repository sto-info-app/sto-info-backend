import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Query parameters for the admin user-search endpoint.
 */
export class UserSearchQueryDto {
  @ApiProperty({
    description: 'Part of a username or of a member’s real name.',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  readonly q: string;

  @ApiPropertyOptional({ description: 'The page to return.', minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: 'How many results per page.',
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  readonly pageSize?: number;
}
