import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';
import { ChatChannelKind } from '../enums/chat.enums';

/**
 * A Community's, a Fleet's or an Armada's chat channel (FC-031).
 *
 * One standard channel per scope, and up to three custom ones, each with
 * the least role that may read it and the least that may post, never lower
 * than reading. Archived rather than deleted.
 */
@Entity({ name: 'chat_channel' })
export class ChatChannelEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  communityId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  armadaId: string | null;

  @ApiProperty({ enum: ChatChannelKind })
  @Column({
    type: 'enum',
    enum: ChatChannelKind,
    enumName: 'chat_channel_kind_enum',
  })
  kind: ChatChannelKind;

  @ApiProperty()
  @Column({ type: 'varchar', length: 50 })
  name: string;

  @ApiProperty({ enum: FleetScopeRole })
  @Column({
    type: 'enum',
    enum: FleetScopeRole,
    enumName: 'fleet_scope_role_enum',
    default: FleetScopeRole.MEMBER,
  })
  readRole: FleetScopeRole;

  @ApiProperty({ enum: FleetScopeRole })
  @Column({
    type: 'enum',
    enum: FleetScopeRole,
    enumName: 'fleet_scope_role_enum',
    default: FleetScopeRole.MEMBER,
  })
  postRole: FleetScopeRole;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  createdByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  archivedAt: Date | null;
}
