import { IsOptional, IsString } from 'class-validator';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { CatalogItemEntity } from 'src/sto/shared/entities/catalog-item.entity';

import { CharacterCommendationProgressEntity } from './character-commendation-progress.entity';

/** The highest commendation rank a captain can attain in a category. */
export const COMMENDATION_MAX_RANK = 4;

@Entity({ name: 'character_commendation' })
@Index('UX_character_commendation_name', ['name'], { unique: true })
export class CharacterCommendationEntity extends CatalogItemEntity {
  /**
   * The general faction this category is exclusive to ("Federation" or
   * "Klingon"), or null where every captain earns it. Diplomacy and Marauding
   * are the two faction-specific categories in game.
   */
  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 50, nullable: true })
  factionRestriction: string | null;

  /**
   * The Klingon variant of the category icon. Categories drawn identically for
   * both factions leave this null and fall back to {@link iconUrl}.
   */
  @IsOptional()
  @IsString()
  @Column({ type: 'varchar', length: 512, nullable: true })
  iconUrlKlingon: string | null;

  @OneToMany(
    'CharacterCommendationProgressEntity',
    (progress: CharacterCommendationProgressEntity) => progress.commendation,
  )
  characterProgress: CharacterCommendationProgressEntity[];
}
