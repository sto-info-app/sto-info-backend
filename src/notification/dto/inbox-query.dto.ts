import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class InboxQueryDto {
  @ApiPropertyOptional({
    description: 'When true, only return unread notifications.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  readonly unreadOnly?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-based).', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  @ApiPropertyOptional({ description: 'Items per page.', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize?: number;
}
