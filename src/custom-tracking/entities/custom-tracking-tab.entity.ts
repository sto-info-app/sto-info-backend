import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { CustomTrackingDefinitionEntity } from './custom-tracking-definition.entity';
import { CustomTrackingSectionEntity } from './custom-tracking-section.entity';

/**
 * A Tab: a group of Fields within a Section.
 *
 * The middle level exists so a Section can hold more than one page's worth of
 * Fields without becoming a wall of them. A Section with a single Tab is
 * ordinary and is rendered without any tab strip at all, so the level costs
 * nothing to a user who does not want it.
 *
 * A Tab has no scope of its own. It takes the Section's, which is what stops a
 * Tab being moved somewhere its Fields' values could not follow.
 */
@Entity({ name: 'custom_tracking_tab' })
@Index('UX_custom_tracking_tab_section_name', ['sectionId', 'nameNormalized'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_custom_tracking_tab_section_order', ['sectionId', 'orderIndex'])
export class CustomTrackingTabEntity extends CustomTrackingDefinitionEntity {
  @ApiProperty({ description: 'The Section this Tab belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  sectionId: string;

  @ManyToOne('CustomTrackingSectionEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sectionId' })
  section: CustomTrackingSectionEntity;
}
