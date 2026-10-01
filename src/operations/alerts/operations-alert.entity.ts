import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { OperationsAlertKind } from './operations-alert.enum';

/**
 * One occurrence of an operations problem (FC-042): opened when the alert
 * cron first sees it, touched each minute it is still there, and cleared
 * when it goes. At most one of each kind is open at once, by a partial
 * unique index, which is what makes "one alert per problem until it clears"
 * a database rule rather than a hope.
 *
 * Its detail is counts and ages only — never a file name, a user or an
 * error's text — and the database refuses anything but numbers in it.
 */
@Entity({ name: 'operations_alert' })
@Index('UX_operations_alert_open', ['kind'], {
  unique: true,
  where: `"clearedAt" IS NULL`,
})
@Index('IDX_operations_alert_opened', ['openedAt'])
export class OperationsAlertEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: OperationsAlertKind })
  @Column({
    type: 'enum',
    enum: OperationsAlertKind,
    enumName: 'operations_alert_kind_enum',
  })
  kind: OperationsAlertKind;

  @ApiProperty({ description: 'When the problem was first seen.' })
  @Column({ type: 'timestamptz', default: () => 'now()' })
  openedAt: Date;

  @ApiProperty({ description: 'When the problem was last seen.' })
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When it cleared; null while it is open.',
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  clearedAt: Date | null;

  @ApiProperty({ description: 'Counts and ages, as last seen.' })
  @Column({ type: 'jsonb', default: () => `'{}'` })
  detail: Record<string, number>;
}
