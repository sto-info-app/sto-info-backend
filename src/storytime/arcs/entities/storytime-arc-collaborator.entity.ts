import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { StorytimeCollaboratorEntity } from '../../shared/entities/storytime-collaborator.entity';

/**
 * Somebody the curator has invited to help assemble an Arc.
 *
 * Mirrors Story collaboration deliberately — the invitation columns are
 * shared through {@link StorytimeCollaboratorEntity} — and the capabilities
 * are named one by one rather than bundled into a role. Somebody brought in
 * to chase up Story owners has not thereby been handed the Arc itself.
 */
@Entity({ name: 'storytime_arc_collaborator' })
@Index(['userId', 'invitationStatus'])
export class StorytimeArcCollaboratorEntity extends StorytimeCollaboratorEntity {
  @ApiProperty({ description: 'The Arc being helped with.' })
  @Column({ type: 'uuid', nullable: false })
  arcId: string;

  @ApiProperty({ description: 'May change the Arc’s own details.' })
  @Column({ type: 'boolean', nullable: false, default: false })
  canEditArc: boolean;

  @ApiProperty({
    description: 'May invite Stories, answer requests and set the order.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  canManageStories: boolean;
}
