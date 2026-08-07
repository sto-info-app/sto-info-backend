import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Common pagination query parameters.
 */
export class PaginatedQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based).',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: 'Items per page.',
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  readonly pageSize?: number;
}

/**
 * Common case-insensitive search plus pagination query parameters.
 */
export class SearchPaginatedQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match.',
    example: 'picard',
    maxLength: 50,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(50)
  readonly search?: string;
}