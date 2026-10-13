import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { AppealStatus } from '../../enums/appeal-status.enum';
import { StorytimeTargetedEntity } from '../../shared/entities/storytime-targeted.entity';

/**
 * A creator's appeal against something of theirs being removed.
 *
 * One appeal per removed item, so an administrator is not asked the same
 * question repeatedly. Withdrawing an appeal frees the creator to put a better
 * argument; having it decided does not — that is what makes a decision a
 * decision.
 */
@Entity({ name: 'storytime_moderation_appeal' })
@Index(['status', 'createdAt'])
export class StorytimeModerationAppealEntity extends StorytimeTargetedEntity {
  @ApiProperty({ description: 'The creator appealing.' })
  @Column({ type: 'uuid', nullable: false })
  appellantUserId: string;

  @ApiProperty({ description: 'What they have to say about it.' })
  @Column({ type: 'varchar', length: 2000, nullable: false })
  body: string;

  @ApiProperty({ enum: AppealStatus, description: 'Where the appeal has got.' })
  @Column({
    type: 'enum',
    enum: AppealStatus,
    enumName: 'storytime_appeal_status_enum',
    default: AppealStatus.SUBMITTED,
  })
  status: AppealStatus;

  @ApiProperty({
    description: 'The administrator who decided it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  reviewedByUserId: string | null;

  @ApiProperty({ description: 'When it was decided.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  reviewedAt: Date | null;

  @ApiProperty({
    description: 'What the administrator said in reply.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  reviewNotes: string | null;
}
