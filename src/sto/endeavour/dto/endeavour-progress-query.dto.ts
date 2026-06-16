import { IsIn, IsOptional } from 'class-validator';

export class EndeavourProgressQueryDto {
  @IsOptional()
  @IsIn(['Space', 'Ground'])
  category?: 'Space' | 'Ground';

  @IsOptional()
  @IsIn(['nodes', 'name'])
  sortBy?: 'nodes' | 'name';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';
}
