import { Expose } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
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
  CharacterReputationEntity,
  REPUTATION_MAX_TIER,
} from './character-reputation.entity';

@Entity({ name: 'character_reputation_progress' })
@Index(
  'UX_character_reputation_progress_character_reputation',
  ['characterId', 'reputationId'],
  {
    unique: true,
  },
)
export class CharacterReputationProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @IsUUID()
  @Column({ type: 'uuid', nullable: false })
  reputationId: string;

  @IsInt()
  @Min(0)
  @Max(REPUTATION_MAX_TIER)
  @Column({ type: 'int', default: 0, nullable: false })
  currentTier: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('CharacterEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne('CharacterReputationEntity', { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reputationId' })
  reputation: CharacterReputationEntity;

  @Expose()
  /**
   * Gets the progress status.
   *
   * @returns The result of the operation.
   */
  get status(): 'not_started' | 'in_progress' | 'complete' {
    if (this.currentTier === 0) return 'not_started';
    if (this.currentTier >= REPUTATION_MAX_TIER) return 'complete';
    return 'in_progress';
  }

  @Expose()
  /**
   * Gets the completion percentage.
   *
   * @returns The result of the operation.
   */
  get completionPercentage(): number {
    return Math.round((this.currentTier / REPUTATION_MAX_TIER) * 100);
  }
}
