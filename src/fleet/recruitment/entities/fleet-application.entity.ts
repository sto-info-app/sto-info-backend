import { ApiProperty } from '@nestjs/swagger';

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
import { UserEntity } from 'src/user/entities/user.entity';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ApplicationAnswer } from '../application-form.interface';
import { FleetApplicationRoute } from '../enums/fleet-application-route.enum';
import { FleetApplicationStatus } from '../enums/fleet-application-status.enum';
import { FleetInvitationEntity } from './fleet-invitation.entity';
import { FleetRecruitmentSettingsEntity } from './fleet-recruitment-settings.entity';

/**
 * How one Character came, or asked, to be in a Fleet (FC-021).
 *
 * Every way in leaves one of these: an application a decider answers, an OPEN
 * Fleet's join, and an accepted invitation, told apart by {@link route}. The
 * last two are accepted as they are made.
 *
 * Private to the applicant and to the Fleet's holders of `applications.view`.
 * What was asked and answered is write-once, and a decision is made once,
 * from `PENDING`: a database trigger refuses anything else. At most one
 * application per Character per Fleet may be pending, by a partial unique
 * index.
 *
 * An acceptance grants the applicant Fleet membership. It does not move their
 * Character into the Fleet in their own records; a proposal carrying this
 * application's ID asks them to confirm that once the in-game invitation has
 * happened, which STO Info cannot do for them.
 */
@Entity({ name: 'fleet_application' })
@Index('UX_fleet_application_pending', ['fleetId', 'characterId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
@Index('IDX_fleet_application_inbox', ['fleetId', 'status', 'submittedAt'])
@Index('IDX_fleet_application_applicant', ['applicantUserId', 'submittedAt'])
@Index('IDX_fleet_application_character', ['characterId'])
export class FleetApplicationEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Community holding the Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  communityId: string;

  @ApiProperty({ description: 'The Fleet.' })
  @Column({ type: 'uuid', nullable: false })
  fleetId: string;

  @ApiProperty({ description: 'Who applied.' })
  @Column({ type: 'uuid', nullable: false })
  applicantUserId: string;

  @ApiProperty({ description: 'The Character they applied with.' })
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @ApiProperty({ enum: FleetApplicationRoute })
  @Column({
    type: 'enum',
    enum: FleetApplicationRoute,
    enumName: 'fleet_application_route_enum',
    nullable: false,
  })
  route: FleetApplicationRoute;

  @ApiProperty({ enum: FleetApplicationStatus })
  @Column({
    type: 'enum',
    enum: FleetApplicationStatus,
    enumName: 'fleet_application_status_enum',
    default: FleetApplicationStatus.PENDING,
    nullable: false,
  })
  status: FleetApplicationStatus;

  @ApiProperty({
    description:
      'The recruitment settings version answered, or null where the Fleet ' +
      'had never saved one.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  settingsId: string | null;

  @ApiProperty({ description: 'The answers, by question.' })
  @Column({ type: 'jsonb', nullable: false, default: [] })
  answers: ApplicationAnswer[];

  @ApiProperty({
    description: 'The invitation accepted, for an INVITATION.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  invitationId: string | null;

  @ApiProperty({ description: 'When it was made.' })
  @Column({ type: 'timestamptz', nullable: false, default: () => 'now()' })
  submittedAt: Date;

  @ApiProperty({ description: 'When it was decided.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  decidedAt: Date | null;

  @ApiProperty({
    description: 'Who decided it, or null for a join or once they have gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  decidedByUserId: string | null;

  @ApiProperty({
    description:
      'Why it was rejected, or a note on its acceptance. The applicant sees it.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  decisionNote: string | null;

  @ApiProperty({ description: 'When it was withdrawn.', nullable: true })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  withdrawnAt: Date | null;

  @ApiProperty({
    description: 'Bumped by each change, so a stale decision is refused.',
  })
  @Column({ type: 'integer', nullable: false, default: 1 })
  revision: number;

  @ApiProperty({ description: 'When the row was written.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'When the row last changed.' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => StoFleetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fleetId' })
  fleet: StoFleetEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'applicantUserId' })
  applicant: UserEntity;

  @ManyToOne(() => CharacterEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity;

  @ManyToOne(() => FleetRecruitmentSettingsEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'settingsId' })
  settings: FleetRecruitmentSettingsEntity | null;

  @ManyToOne(() => FleetInvitationEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invitationId' })
  invitation: FleetInvitationEntity | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decidedByUserId' })
  decidedBy: UserEntity | null;
}
