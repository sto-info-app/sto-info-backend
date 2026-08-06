import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RegistrySort } from '../enums/registry-sort.enum';

/**
 * Query parameters accepted by the registry profile listing.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class RegistryQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match against the profile username.',
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

  @ApiPropertyOptional({
    enum: RegistrySort,
    description: 'Ordering applied to the results.',
    default: RegistrySort.USERNAME,
  })
  @IsOptional()
  @IsEnum(RegistrySort)
  readonly sort?: RegistrySort;

  @ApiPropertyOptional({
    description: 'Page number (1-based).',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({
    description: 'Items per page.',
    default: 12,
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
