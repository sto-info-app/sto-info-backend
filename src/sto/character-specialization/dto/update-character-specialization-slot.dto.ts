import { IsIn } from 'class-validator';
import { SpecializationSlot } from '../entities/character-specialization-progress.entity';

export class UpdateCharacterSpecializationSlotDto {
  /**
   * The captain slot to activate this specialization in, or null to deactivate
   * it. Assigning a slot moves it off whichever specialization held it before.
   */
  @IsIn(['primary', 'secondary', null])
  slot: SpecializationSlot | null;
}
