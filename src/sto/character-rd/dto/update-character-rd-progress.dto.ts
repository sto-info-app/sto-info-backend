import { IsInt, Max, Min } from 'class-validator';
import { RD_MAX_LEVEL } from '../entities/character-rd-school.entity';

export class UpdateCharacterRdProgressDto {
  @IsInt()
  @Min(0)
  @Max(RD_MAX_LEVEL)
  currentLevel: number;
}
