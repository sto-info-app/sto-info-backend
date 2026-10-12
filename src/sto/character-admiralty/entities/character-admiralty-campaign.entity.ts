import { Entity, Index, OneToMany } from 'typeorm';

import { CatalogItemEntity } from 'src/sto/shared/entities/catalog-item.entity';

import { CharacterAdmiraltyProgressEntity } from './character-admiralty-progress.entity';

export const ADMIRALTY_MAX_TIER = 10;
/**
 * The furthest a Tour of Duty can be recorded at. The game pays the tour
 * reward on the tenth step and starts the tour again, so step ten is never
 * a state a captain sits in: the count runs 0 to 9 and rolls back to 0.
 */
export const ADMIRALTY_MAX_TOUR_STEP = 9;

@Entity({ name: 'character_admiralty_campaign' })
@Index('UX_character_admiralty_campaign_name', ['name'], { unique: true })
export class CharacterAdmiraltyCampaignEntity extends CatalogItemEntity {
  @OneToMany(
    'CharacterAdmiraltyProgressEntity',
    (progress: CharacterAdmiraltyProgressEntity) => progress.campaign,
  )
  characterProgress: CharacterAdmiraltyProgressEntity[];
}
