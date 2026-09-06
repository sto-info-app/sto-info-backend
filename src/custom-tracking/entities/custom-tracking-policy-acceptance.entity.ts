import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A user's agreement to the Custom Tracking Content Agreement.
 *
 * One row per user, holding the version they most recently accepted. The
 * history of their acceptances is not kept here: the audit trail already
 * records every change to this row with its actor and timestamp, and a second
 * append-only table would say the same thing twice while growing without
 * bound for anybody who reads a new version each time it changes.
 *
 * One row covers both target scopes. The agreement is about what a user may
 * store, which does not differ between their Accounts and their Characters,
 * and asking twice for the same undertaking would be a worse experience for no
 * additional protection.
 *
 * The policy dates are copied in alongside the version rather than being
 * looked up from the current constants when the row is read. The constants say
 * what the agreement is now; this row has to say what it was when the user
 * agreed, which is the only thing that makes the record evidence of anything.
 */
@Entity({ name: 'custom_tracking_policy_acceptance' })
@Index('UX_custom_tracking_policy_acceptance_user', ['userId'], {
  unique: true,
})
export class CustomTrackingPolicyAcceptanceEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The user who accepted.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description: 'The exact agreement version accepted.',
    example: '1.0',
  })
  @Column({ type: 'varchar', length: 20, nullable: false })
  policyVersion: string;

  @ApiProperty({ description: 'When the user accepted it.' })
  @Column({ type: 'timestamp', nullable: false })
  acceptedAt: Date;

  @ApiProperty({
    description: 'The effective date the accepted wording carried.',
  })
  @Column({ type: 'date', nullable: false })
  policyEffectiveDate: string;

  @ApiProperty({
    description: 'The last-updated date the accepted wording carried.',
  })
  @Column({ type: 'date', nullable: false })
  policyUpdatedDate: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
