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
  ADMIRALTY_MAX_TIER,
  ADMIRALTY_MAX_TOUR_STEP,
  CharacterAdmiraltyCampaignEntity,
} from './character-admiralty-campaign.entity';

@Entity({ name: 'character_admiralty_progress' })
@Index(
  'UX_character_admiralty_progress_character_campaign',
  ['characterId', 'campaignId'],
  { unique: true },
)
export class CharacterAdmiraltyProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @IsUUID()
  @Column({ type: 'uuid' })
  characterId: string;

  @IsUUID()
  @Column({ type: 'uuid' })
  campaignId: string;

  @IsInt()
  @Min(0)
  @Max(ADMIRALTY_MAX_TIER)
  @Column({ type: 'int', default: 0 })
  currentTier: number;

  @IsInt()
  @Min(0)
  @Max(ADMIRALTY_MAX_TOUR_STEP)
  @Column({ type: 'int', default: 0 })
  tourOfDutyStep: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('CharacterEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne('CharacterAdmiraltyCampaignEntity', {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaignId' })
  campaign: CharacterAdmiraltyCampaignEntity;

  @Expose()
  get status(): 'not_started' | 'in_progress' | 'complete' {
    if (this.currentTier === 0 && this.tourOfDutyStep === 0)
      return 'not_started';
    if (this.currentTier >= ADMIRALTY_MAX_TIER) return 'complete';
    return 'in_progress';
  }

  @Expose()
  get completionPercentage(): number {
    return Math.round((this.currentTier / ADMIRALTY_MAX_TIER) * 100);
  }
}
