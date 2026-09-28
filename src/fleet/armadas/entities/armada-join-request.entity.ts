import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { ArmadaJoinRequestStatus } from '../enums/armada-join-request-status.enum';

/**
 * A Fleet's request to join an Armada in its own Community (FC-025).
 *
 * Made by whoever holds `armada.request` at the Fleet, and answered by an
 * `armada.manage` holder, who chooses where the Fleet goes. It lapses after
 * fourteen days. A Fleet has at most one open request at a time, by partial
 * unique index, and a trigger keeps what was asked, and any answer, as it was
 * first recorded.
 */
@Entity({ name: 'armada_join_request' })
@Index('UX_armada_join_request_open', ['fleetId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
@Index('IDX_armada_join_request_armada', ['armadaId', 'status', 'createdAt'])
@Index('IDX_armada_join_request_open_expiry', ['expiresAt'], {
  where: `"status" = 'PENDING'`,
})
export class ArmadaJoinRequestEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community holding both.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The Armada asked.' })
  @Column({ type: 'uuid', nullable: false })
  armadaId: string;

  @ApiProperty({ description: 'The Fleet asking.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({
    description: 'Who asked, or null once their account has gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  requestedByUserId: string | null;

  @ApiProperty({ description: 'What they said, if anything.', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  message: string | null;

  @ApiProperty({ enum: ArmadaJoinRequestStatus })
  @Column({
    type: 'enum',
    enum: ArmadaJoinRequestStatus,
    enumName: 'armada_join_request_status_enum',
    default: ArmadaJoinRequestStatus.PENDING,
  })
  status: ArmadaJoinRequestStatus;

  @ApiProperty({ description: 'When it was made.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  createdAt: Date;

  @ApiProperty({ description: 'When it lapses unanswered.' })
  @Column({ type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @ApiProperty({
    description: 'When it stopped being open, or null while it is.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  answeredAt: Date | null;

  @ApiProperty({
    description: 'Who answered or withdrew it, where anybody did.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  answeredByUserId: string | null;

  @ApiProperty({
    description: 'Why, for a rejection, which requires one.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  reason: string | null;

  @ApiProperty({
    description: 'The placement an approval made.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  membershipId: string | null;
}
