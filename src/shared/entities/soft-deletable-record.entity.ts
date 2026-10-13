import { DeleteDateColumn } from 'typeorm';

import { TimestampedRecordEntity } from './timestamped-record.entity';

/**
 * A {@link TimestampedRecordEntity} that is soft-deleted rather than removed:
 * `deletedAt` is set, and TypeORM leaves the row out of ordinary reads from
 * then on.
 */
export abstract class SoftDeletableRecordEntity extends TimestampedRecordEntity {
  @DeleteDateColumn()
  deletedAt: Date | null;
}
