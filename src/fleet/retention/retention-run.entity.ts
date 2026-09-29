import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { RetentionJob } from './retention-job.enum';

/**
 * One run of one Fleet retention job (FC-037): when, what it deleted, whether
 * it got through everything due, and why it stopped if it failed. Finished
 * once, then write-once by trigger.
 */
@Entity({ name: 'retention_run' })
@Index('IDX_retention_run_job', ['job', 'startedAt'])
export class RetentionRunEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: RetentionJob })
  @Column({
    type: 'enum',
    enum: RetentionJob,
    enumName: 'retention_job_enum',
  })
  job: RetentionJob;

  @ApiProperty()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: Boolean,
    description:
      'Whether it got through everything due; false when it stopped at its ' +
      'limit, and the next run carries on, or failed.',
  })
  @Column({ type: 'boolean', nullable: true, default: null })
  complete: boolean | null;

  @ApiProperty({ nullable: true, description: 'What it did, by kind.' })
  @Column({ type: 'jsonb', nullable: true, default: null })
  counts: Record<string, number> | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  error: string | null;
}
