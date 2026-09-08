import { IsOptional, IsString } from 'class-validator';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { CatalogItemEntity } from 'src/sto/shared/entities/catalog-item.entity';

import { CharacterReputationProgressEntity } from './character-reputation-progress.entity';

/** The maximum reputation tier a character can attain. */
export const REPUTATION_MAX_TIER = 6;

@Entity({ name: 'character_reputation' })
@Index('UX_character_reputation_name', ['name'], { unique: true })
export class CharacterReputationEntity extends CatalogItemEntity {
  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 255, nullable: true })
  releasedWith: string | null;

  @OneToMany(
    'CharacterReputationProgressEntity',
    (progress: CharacterReputationProgressEntity) => progress.reputation,
  )
  characterProgress: CharacterReputationProgressEntity[];
}
