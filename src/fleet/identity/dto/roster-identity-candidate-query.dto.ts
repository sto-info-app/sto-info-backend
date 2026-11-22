import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional } from 'class-validator';

import { PaginatedQueryDto } from 'src/shared/dto/paginated-query.dto';

import { RosterIdentityCandidateState } from '../enums/roster-identity-candidate-state.enum';

/** Which of a Fleet's rename candidates to list. */
export class RosterIdentityCandidateQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    enum: RosterIdentityCandidateState,
    description: 'Only candidates in this state. Every state when omitted.',
  })
  @IsOptional()
  @IsEnum(RosterIdentityCandidateState)
  readonly state?: RosterIdentityCandidateState;
}
