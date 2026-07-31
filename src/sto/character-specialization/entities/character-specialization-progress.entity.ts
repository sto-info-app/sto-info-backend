import { Expose } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CharacterSpecializationEntity,
  SPECIALIZATION_PRIMARY_MAX_POINTS,
  SPECIALIZATION_QUALIFICATION_POINTS,
} from './character-specialization.entity';

/**
 * The captain slot a specialization is currently active in. A character may
 * have at most one Primary and one Secondary specialization active at a time;
 * everything else is purchased but inactive.
 */
export type SpecializationSlot = 'primary' | 'secondary';

@Entity({ name: 'character_specialization_progress' })
@Index(
  'UX_character_specialization_progress_character_specialization',
  ['characterId', 'specializationId'],
  {
    unique: true,
  },
)
export class CharacterSpecializationProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  specializationId: string;

  @IsInt()
  @Min(0)
  @Max(SPECIALIZATION_PRIMARY_MAX_POINTS)
  @Column({ type: 'int', default: 0, nullable: false })
  pointsSpent: number;

  @IsOptional()
  @Column({ type: 'varchar', length: 16, nullable: true })
  slot: SpecializationSlot | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('CharacterEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne('CharacterSpecializationEntity', {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'specializationId' })
  specialization: CharacterSpecializationEntity;

  @Expose()
  /**
   * Gets the progress status.
   *
   * @returns The result of the operation.
   */
  get status(): 'not_started' | 'in_progress' | 'complete' {
    if (this.pointsSpent === 0) return 'not_started';
    if (this.pointsSpent >= this.maxPoints) return 'complete';
    return 'in_progress';
  }

  @Expose()
  /**
   * Gets the completion percentage.
   *
   * @returns The result of the operation.
   */
  get completionPercentage(): number {
    if (this.maxPoints <= 0) return 0;
    return Math.round((this.pointsSpent / this.maxPoints) * 100);
  }

  @Expose()
  /**
   * Gets whether the Specialization Qualification for training bridge officers
   * has been unlocked. Secondary-only specializations have no qualification.
   *
   * @returns The result of the operation.
   */
  get qualificationUnlocked(): boolean {
    return (
      this.specialization?.type === 'primary' &&
      this.pointsSpent >= SPECIALIZATION_QUALIFICATION_POINTS
    );
  }

  /** The point total that fully completes this specialization. */
  private get maxPoints(): number {
    return this.specialization?.maxPoints ?? SPECIALIZATION_PRIMARY_MAX_POINTS;
  }
}
