import { Entity, Index, OneToMany } from 'typeorm';

import { CatalogItemEntity } from 'src/sto/shared/entities/catalog-item.entity';

import { CharacterAdmiraltyProgressEntity } from './character-admiralty-progress.entity';

export const ADMIRALTY_MAX_TIER = 10;
export const ADMIRALTY_MAX_TOUR_STEP = 10;

@Entity({ name: 'character_admiralty_campaign' })
@Index('UX_character_admiralty_campaign_name', ['name'], { unique: true })
export class CharacterAdmiraltyCampaignEntity extends CatalogItemEntity {
  @OneToMany(
    'CharacterAdmiraltyProgressEntity',
    (progress: CharacterAdmiraltyProgressEntity) => progress.campaign,
  )
  characterProgress: CharacterAdmiraltyProgressEntity[];
}
