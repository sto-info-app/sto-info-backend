import { IsInt, Max, Min } from 'class-validator';

import {
  ADMIRALTY_MAX_TIER,
  ADMIRALTY_MAX_TOUR_STEP,
} from '../entities/character-admiralty-campaign.entity';

export class UpdateCharacterAdmiraltyProgressDto {
  @IsInt()
  @Min(0)
  @Max(ADMIRALTY_MAX_TIER)
  currentTier: number;

  @IsInt()
  @Min(0)
  @Max(ADMIRALTY_MAX_TOUR_STEP)
  tourOfDutyStep: number;
}
