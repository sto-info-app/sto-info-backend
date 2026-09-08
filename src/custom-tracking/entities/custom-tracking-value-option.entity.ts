import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { CustomTrackingOptionEntity } from './custom-tracking-option.entity';
import { CustomTrackingValueEntity } from './custom-tracking-value.entity';

/**
 * One option chosen by one value.
 *
 * A row per selection, rather than a list of identifiers inside the value's
 * JSON. That is the whole reason this table exists: a foreign key here is
 * something the database can see, so an option cannot be hard-deleted while a
 * value still names it, and the retention job has something to consult before
 * it tries. Identifiers buried in a JSON document would be invisible to both.
 *
 * There is no soft deletion. A selection is either made or it is not — when a
 * user changes their answer the old rows go and the new ones arrive, and the
 * value row above carries the timestamps that say when. What survives a
 * deleted option is the option itself, retained for as long as anything points
 * here.
 */
@Entity({ name: 'custom_tracking_value_option' })
@Index('UX_custom_tracking_value_option', ['valueId', 'optionId'], {
  unique: true,
})
@Index('IDX_custom_tracking_value_option_option', ['optionId'])
export class CustomTrackingValueOptionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The value that made this selection.' })
  @Column({ type: 'uuid', nullable: false })
  valueId: string;

  @ManyToOne('CustomTrackingValueEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'valueId' })
  value: CustomTrackingValueEntity;

  /**
   * The option chosen.
   *
   * Referenced by identifier, never by label, so a label can be corrected
   * without rewriting every value that chose it and a withdrawn option keeps
   * displaying the wording it had.
   */
  @ApiProperty({ description: 'The option chosen.' })
  @Column({ type: 'uuid', nullable: false })
  optionId: string;

  @ManyToOne('CustomTrackingOptionEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'optionId' })
  option: CustomTrackingOptionEntity;

  @ApiProperty({
    description: 'Position among the selections, for ordered presentation.',
  })
  @Column({ type: 'integer', nullable: false, default: 0 })
  orderIndex: number;

  @CreateDateColumn()
  createdAt: Date;
}
