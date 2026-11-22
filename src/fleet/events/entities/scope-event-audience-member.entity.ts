import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { FleetScopeRole } from '../../enums/fleet-scope-role.enum';

/**
 * One chosen Fleet, or one chosen role, an event is shown to (FC-028).
 *
 * Exactly one of the two. A chosen Fleet is in the event's own Community, by
 * the composite key.
 */
@Entity({ name: 'scope_event_audience_member' })
@Index('UX_scope_event_audience_member_fleet', ['eventId', 'fleetId'], {
  unique: true,
  where: '"fleetId" IS NOT NULL',
})
@Index('UX_scope_event_audience_member_role', ['eventId', 'role'], {
  unique: true,
  where: '"role" IS NOT NULL',
})
export class ScopeEventAudienceMemberEntity {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  eventId: string;

  @ApiProperty()
  @Column({ type: 'uuid' })
  communityId: string;

  @ApiProperty({ nullable: true, type: String })
  @Column({ type: 'uuid', nullable: true, default: null })
  fleetId: string | null;

  @ApiProperty({ enum: FleetScopeRole, nullable: true })
  @Column({
    type: 'enum',
    enum: FleetScopeRole,
    enumName: 'fleet_scope_role_enum',
    nullable: true,
    default: null,
  })
  role: FleetScopeRole | null;
}
