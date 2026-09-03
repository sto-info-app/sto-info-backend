import { IsInt, Max, Min } from 'class-validator';

import { SPECIALIZATION_PRIMARY_MAX_POINTS } from '../entities/character-specialization.entity';

export class UpdateCharacterSpecializationProgressDto {
  @IsInt()
  @Min(0)
  @Max(SPECIALIZATION_PRIMARY_MAX_POINTS)
  pointsSpent: number;
}
