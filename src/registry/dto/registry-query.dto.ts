import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SearchPaginatedQueryDto } from '../../shared/dto/paginated-query.dto';
import { RegistrySort } from '../enums/registry-sort.enum';

/**
 * Query parameters accepted by the registry profile listing.
 *
 * Every accepted parameter must be declared here — the global `ValidationPipe`
 * runs with `forbidNonWhitelisted: true`, so undeclared params are rejected.
 */
export class RegistryQueryDto extends SearchPaginatedQueryDto {

  @ApiPropertyOptional({
    enum: RegistrySort,
    description: 'Ordering applied to the results.',
    default: RegistrySort.USERNAME,
  })
  @IsOptional()
  @IsEnum(RegistrySort)
  readonly sort?: RegistrySort;

}
