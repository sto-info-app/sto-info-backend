import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, Index } from 'typeorm';

import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingDefinitionEntity } from './custom-tracking-definition.entity';

/**
 * A Section: the outermost grouping a user organises their own Fields into.
 *
 * A Section belongs to a target scope, not to one Account or Character. That
 * is the whole shape of the feature: a user describes what they want to track
 * once, and answers it separately for each record it applies to.
 *
 * The scope cannot be changed afterwards. Every value beneath a Section hangs
 * off an Account or a Character, and the other scope has no row for those
 * values to move to, so a scope change would silently destroy them. A user who
 * wants the same structure on the other side builds it there.
 *
 * `nameNormalized` exists because names are unique without regard to case
 * within a scope. Comparing lower-cased text in an index is what makes that
 * uniqueness the database's job rather than a check that races under
 * concurrent creation.
 */
@Entity({ name: 'custom_tracking_section' })
@Index(
  'UX_custom_tracking_section_user_scope_name',
  ['userId', 'targetScope', 'nameNormalized'],
  { unique: true, where: '"deletedAt" IS NULL' },
)
@Index('IDX_custom_tracking_section_user_scope_order', [
  'userId',
  'targetScope',
  'orderIndex',
])
export class CustomTrackingSectionEntity extends CustomTrackingDefinitionEntity {
  @ApiProperty({ description: 'The user who owns this Section.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description:
      'Whether this Section describes Accounts or Characters. Fixed at creation.',
    enum: CustomTrackingTargetScope,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingTargetScope,
    enumName: 'custom_tracking_target_scope_enum',
    nullable: false,
  })
  targetScope: CustomTrackingTargetScope;
}
