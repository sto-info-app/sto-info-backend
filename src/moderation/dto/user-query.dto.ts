import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginatedQueryDto } from '../../shared/dto/paginated-query.dto';

/**
 * Query parameters accepted by the admin user list.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class ModeratedUserQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match against the member’s email or username.',
    example: 'picard',
    maxLength: 255,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(255)
  readonly search?: string;

  @ApiPropertyOptional({
    description:
      'Restrict to disabled (`true`) or active (`false`) members. Omit for both.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) {
      return true;
    }
    if (value === 'false' || value === false) {
      return false;
    }
    return value;
  })
  @IsBoolean()
  readonly disabled?: boolean;
}
