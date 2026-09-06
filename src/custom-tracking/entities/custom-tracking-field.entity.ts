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

import { CustomTrackingFieldConfiguration } from '../constants/custom-tracking-field-configuration.interface';
import { CustomTrackingDefaultValue } from '../constants/custom-tracking-value.interface';
import { CustomTrackingEmptyMode } from '../enums/custom-tracking-empty-mode.enum';
import { CustomTrackingFieldType } from '../enums/custom-tracking-field-type.enum';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingTabEntity } from './custom-tracking-tab.entity';

/**
 * A Field: one question a user asks of each of their Accounts or Characters.
 *
 * The type is chosen once and is then immutable. It decides how every value
 * already recorded against the Field is stored, validated and rendered, so
 * reinterpreting a stored decimal as a date, or a set of option references as
 * free text, would destroy data the user cannot recover. Changing the kind of
 * question means asking a new one and retiring the old.
 *
 * `userId` and `targetScope` are copies of what the owning Section already
 * says. They are duplicated deliberately, and safely: a Section's owner and
 * scope are both immutable, so neither copy can drift from its original. What
 * they buy is that the two limits counted per scope — two hundred active
 * Fields, four hundred including deleted ones — and every ownership check can
 * be answered without walking back up through the Tab and the Section, which
 * is the difference between one indexed read and a join on the hot path of
 * every page that renders custom data.
 *
 * `configuration` and `defaultValue` are JSONB because what belongs in them
 * differs by type, and twenty-seven sets of columns would be mostly null in
 * every row. PostgreSQL will accept any shape into them, so the DTO and
 * service validation keyed by field type is the only thing that keeps them
 * meaningful — there is no schema here to fall back on.
 */
@Entity({ name: 'custom_tracking_field' })
@Index('UX_custom_tracking_field_tab_name', ['tabId', 'nameNormalized'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_custom_tracking_field_tab_order', ['tabId', 'orderIndex'])
@Index('IDX_custom_tracking_field_user_scope', ['userId', 'targetScope'])
export class CustomTrackingFieldEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Tab this Field belongs to.' })
  @Column({ type: 'uuid', nullable: false })
  tabId: string;

  @ManyToOne('CustomTrackingTabEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tabId' })
  tab: CustomTrackingTabEntity;

  @ApiProperty({
    description:
      'The owning user. A copy of the Section’s, which cannot change.',
  })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    description:
      'The target scope. A copy of the Section’s, which cannot change.',
    enum: CustomTrackingTargetScope,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingTargetScope,
    enumName: 'custom_tracking_target_scope_enum',
    nullable: false,
  })
  targetScope: CustomTrackingTargetScope;

  @ApiProperty({
    description: 'The kind of answer this Field asks for. Fixed at creation.',
    enum: CustomTrackingFieldType,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingFieldType,
    enumName: 'custom_tracking_field_type_enum',
    nullable: false,
  })
  fieldType: CustomTrackingFieldType;

  @ApiProperty({ description: 'The label shown beside the answer.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({
    description:
      'The name lower-cased, so sibling names are unique without regard to case.',
  })
  @Column({ type: 'varchar', length: 100, nullable: false })
  nameNormalized: string;

  @ApiProperty({
    description: 'Help text explaining what to enter.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({ description: 'Position among its siblings.' })
  @Column({ type: 'integer', nullable: false })
  orderIndex: number;

  @ApiProperty({
    description:
      'Whether the Field may be shown publicly. A private ancestor hides it regardless.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  publiclyVisible: boolean;

  @ApiProperty({
    description:
      'Whether a value is required before the record being edited can be saved.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  required: boolean;

  @ApiProperty({
    description: 'What the owner sees where this Field has no value.',
    enum: CustomTrackingEmptyMode,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingEmptyMode,
    enumName: 'custom_tracking_empty_mode_enum',
    nullable: false,
    default: CustomTrackingEmptyMode.SHOW_LABEL,
  })
  ownerEmptyMode: CustomTrackingEmptyMode;

  @ApiProperty({
    description: 'What the public sees where this Field has no value.',
    enum: CustomTrackingEmptyMode,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingEmptyMode,
    enumName: 'custom_tracking_empty_mode_enum',
    nullable: false,
    default: CustomTrackingEmptyMode.HIDE,
  })
  publicEmptyMode: CustomTrackingEmptyMode;

  @ApiProperty({
    description:
      'The text shown where a value is absent and the mode calls for one. Shared by both views.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  emptyPlaceholder: string | null;

  @ApiProperty({
    description: 'Type-specific configuration, validated by field type.',
  })
  @Column({ type: 'jsonb', nullable: false })
  configuration: CustomTrackingFieldConfiguration;

  @ApiProperty({
    description:
      'What an editor with no value starts from. Never overwrites a value that exists.',
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true, default: null })
  defaultValue: CustomTrackingDefaultValue;

  @ApiProperty({
    description:
      'When an administrator suppressed this Field from public view, if they have.',
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
