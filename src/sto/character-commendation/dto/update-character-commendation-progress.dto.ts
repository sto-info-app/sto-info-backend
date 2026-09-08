import { IsInt, Max, Min } from 'class-validator';

import { COMMENDATION_MAX_RANK } from '../entities/character-commendation.entity';

export class UpdateCharacterCommendationProgressDto {
  @IsInt()
  @Min(0)
  @Max(COMMENDATION_MAX_RANK)
  currentRank: number;
}
