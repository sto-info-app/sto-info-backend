import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

import { TimestampedRecordEntity } from '../../../shared/entities/timestamped-record.entity';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * A row about one piece of Storytime content — a comment on it, or an appeal
 * against its removal — named by its kind and identifier.
 *
 * Polymorphic by design: a Story, a Chapter and an Arc are different tables,
 * so there is no single foreign key to hold the target, and the pair is what
 * the indexes and the service queries filter on instead.
 */
export abstract class StorytimeTargetedEntity extends TimestampedRecordEntity {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content it is about.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTargetType,
    enumName: 'storytime_target_type_enum',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content it is about.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;
}
