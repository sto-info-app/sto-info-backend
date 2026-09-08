import { Expose } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
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

import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import {
  CharacterCommendationEntity,
  COMMENDATION_MAX_RANK,
} from './character-commendation.entity';

@Entity({ name: 'character_commendation_progress' })
@Index(
  'UX_character_commendation_progress_character_commendation',
  ['characterId', 'commendationId'],
  { unique: true },
)
export class CharacterCommendationProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  commendationId: string;

  @IsInt()
  @Min(0)
  @Max(COMMENDATION_MAX_RANK)
  @Column({ type: 'int', default: 0, nullable: false })
  currentRank: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('CharacterEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne('CharacterCommendationEntity', {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'commendationId' })
  commendation: CharacterCommendationEntity;

  @Expose()
  /**
   * Gets the progress status.
   *
   * @returns The result of the operation.
   */
  get status(): 'not_started' | 'in_progress' | 'complete' {
    if (this.currentRank === 0) return 'not_started';
    if (this.currentRank >= COMMENDATION_MAX_RANK) return 'complete';
    return 'in_progress';
  }

  @Expose()
  /**
   * Gets the completion percentage.
   *
   * @returns The result of the operation.
   */
  get completionPercentage(): number {
    return Math.round((this.currentRank / COMMENDATION_MAX_RANK) * 100);
  }
}
