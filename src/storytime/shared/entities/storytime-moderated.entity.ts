import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

import { SoftDeletableRecordEntity } from '../../../shared/entities/soft-deletable-record.entity';
import { StorytimeModerationStatus } from '../../enums/storytime-moderation-status.enum';

/**
 * The moderation and authorship columns every piece of Storytime content an
 * administrator can remove carries: whether it has been removed, when, by
 * whom and with what explanation, and who created and last changed it.
 *
 * `moderationStatus` is kept apart from any publication state the content
 * has, which is what lets a removal be undone to exactly where the creator
 * left things, and stops a creator republishing their way out of it.
 */
export abstract class StorytimeModeratedEntity extends SoftDeletableRecordEntity {
  @ApiProperty({
    enum: StorytimeModerationStatus,
    description:
      'Whether an administrator has removed it. Independent of publication state.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeModerationStatus,
    enumName: 'storytime_moderation_status_enum',
    default: StorytimeModerationStatus.ACTIVE,
  })
  moderationStatus: StorytimeModerationStatus;

  @ApiProperty({ description: 'When it was removed.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  removedAt: Date | null;

  @ApiProperty({
    description: 'Administrator who removed it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  removedByUserId: string | null;

  @ApiProperty({
    description: 'Explanation shown to the creator verbatim.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  moderationMessage: string | null;

  @ApiProperty({ description: 'User who created it.' })
  @Column({ type: 'uuid', nullable: false })
  createdByUserId: string;

  @ApiProperty({ description: 'User who last changed it.' })
  @Column({ type: 'uuid', nullable: false })
  updatedByUserId: string;
}
