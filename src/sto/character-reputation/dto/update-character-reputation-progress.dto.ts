import { IsInt, Max, Min } from 'class-validator';
import { REPUTATION_MAX_TIER } from '../entities/character-reputation.entity';

export class UpdateCharacterReputationProgressDto {
  @IsInt()
  @Min(0)
  @Max(REPUTATION_MAX_TIER)
  currentTier: number;
}
