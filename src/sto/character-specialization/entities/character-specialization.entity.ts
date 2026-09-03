import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { BeforeInsert, Column, Entity, Index, OneToMany } from 'typeorm';

import { CatalogItemEntity } from 'src/sto/shared/entities/catalog-item.entity';

import { CharacterSpecializationProgressEntity } from './character-specialization-progress.entity';

/**
 * Whether a specialization can be slotted as a captain's Primary (and therefore
 * also as their Secondary), or is a Secondary-only specialization.
 */
export type SpecializationType = 'primary' | 'secondary';

/** Points needed to fully purchase a Primary-capable specialization. */
export const SPECIALIZATION_PRIMARY_MAX_POINTS = 30;

/** Points needed to fully purchase a Secondary-only specialization. */
export const SPECIALIZATION_SECONDARY_MAX_POINTS = 15;

/**
 * Points that must be spent in a Primary-capable specialization before its
 * Specialization Qualification (bridge officer training manual) can be crafted.
 */
export const SPECIALIZATION_QUALIFICATION_POINTS = 10;

@Entity({ name: 'character_specialization' })
@Index('UX_character_specialization_name', ['name'], { unique: true })
export class CharacterSpecializationEntity extends CatalogItemEntity {
  @IsIn(['primary', 'secondary'])
  @Column({ type: 'varchar', length: 16, nullable: false })
  type: SpecializationType;

  @IsInt()
  @Min(1)
  @Max(SPECIALIZATION_PRIMARY_MAX_POINTS)
  @Column({
    type: 'int',
    nullable: false,
  })
  maxPoints: number;

  @ValidateIf(
    (specialization: CharacterSpecializationEntity) =>
      specialization.type === 'secondary',
  )
  @Max(SPECIALIZATION_SECONDARY_MAX_POINTS)
  get secondaryMaxPoints(): number {
    return this.maxPoints;
  }

  @BeforeInsert()
  setDefaultMaxPoints(): void {
    this.maxPoints ??=
      this.type === 'secondary'
        ? SPECIALIZATION_SECONDARY_MAX_POINTS
        : SPECIALIZATION_PRIMARY_MAX_POINTS;
  }

  @OneToMany(
    'CharacterSpecializationProgressEntity',
    (progress: CharacterSpecializationProgressEntity) =>
      progress.specialization,
  )
  characterProgress: CharacterSpecializationProgressEntity[];
}
