import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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
export class CustomTrackingTabEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Section this Tab belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  sectionId: string;

  @ManyToOne('CustomTrackingSectionEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sectionId' })
  section: CustomTrackingSectionEntity;

  @ApiProperty({ description: 'The label on the tab itself.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({
    description:
      'The name lower-cased, so sibling names are unique without regard to case.',
  })
  @Column({ type: 'varchar', length: 100, nullable: false })
  nameNormalized: string;

  @ApiProperty({
    description: 'What the Tab groups together.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({ description: 'Position among its siblings.' })
  @Column({ type: 'integer', nullable: false })
  orderIndex: number;

  @ApiProperty({
    description:
      'Whether the Tab may be shown publicly. A private Section hides it regardless.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  publiclyVisible: boolean;

  @ApiProperty({
    description:
      'When an administrator suppressed this Tab from public view, if they have.',
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  suppressedAt: Date | null;

  @ApiProperty({
    description: 'The administrator who suppressed it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  suppressedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
