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

import { UserEntity } from 'src/user/entities/user.entity';

import { FleetApplicationActionKind } from '../enums/fleet-application-action-kind.enum';
import { FleetApplicationEntity } from './fleet-application.entity';

/**
 * One thing that happened to an application, and who did it (FC-021).
 *
 * The audit the story's fourth criterion asks for. Append-only: a database
 * trigger refuses any change but the actor's account being deleted. A
 * rejection carries its reason.
 */
@Entity({ name: 'fleet_application_action' })
@Index('IDX_fleet_application_action_application', [
  'applicationId',
  'createdAt',
])
@Index('IDX_fleet_application_action_actor', ['actorUserId'])
export class FleetApplicationActionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The application.' })
  @Column({ type: 'uuid', nullable: false })
  applicationId: string;

  @ApiProperty({ enum: FleetApplicationActionKind })
  @Column({
    type: 'enum',
    enum: FleetApplicationActionKind,
    enumName: 'fleet_application_action_enum',
    nullable: false,
  })
  action: FleetApplicationActionKind;

  @ApiProperty({
    description: 'Who did it, or null for a join or once they have gone.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  actorUserId: string | null;

  @ApiProperty({
    description: 'The reason or note given, if any.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 1000, nullable: true, default: null })
  note: string | null;

  @ApiProperty({ description: 'When it happened.' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => FleetApplicationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'applicationId' })
  application: FleetApplicationEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actorUserId' })
  actor: UserEntity | null;
}
