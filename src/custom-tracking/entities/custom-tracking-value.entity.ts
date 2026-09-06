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

import { RedactFromAudit } from 'src/audit/audit-redaction';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { CustomTrackingValue } from '../constants/custom-tracking-value.interface';
import { CustomTrackingTargetScope } from '../enums/custom-tracking-target-scope.enum';
import { CustomTrackingFieldEntity } from './custom-tracking-field.entity';

/**
 * One user's answer to one Field, for one Account or one Character.
 *
 * Exactly one of the two targets is set, and which one is decided by the
 * Field's scope. Both facts are the database's to keep rather than the
 * service's: a check constraint refuses a row that names neither target or
 * both, and a composite foreign key onto the Field's own identifier and scope
 * refuses an Account value recorded against a Character-scoped Field. A
 * service check alone would leave the first bad row to be found by whatever
 * tried to render it.
 *
 * The typed fragment lives in `value`, whose shape depends on the Field's
 * type. Choice, tag and image answers are not in there at all — they are rows
 * in their own tables, so a foreign key can stop an option being deleted while
 * something still names it.
 *
 * Absence is meaningful and is represented by there being no row. That is what
 * keeps "unset" distinct from `false`, from zero, from an empty selection and
 * from an empty string, all of which are answers somebody may have given
 * deliberately. Clearing a value deletes the row rather than writing an empty
 * one.
 */
@Entity({ name: 'custom_tracking_value' })
@Index('IDX_custom_tracking_value_account', ['accountId'])
@Index('IDX_custom_tracking_value_character', ['characterId'])
@Index('IDX_custom_tracking_value_field', ['fieldId'])
export class CustomTrackingValueEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Field being answered.' })
  @Column({ type: 'uuid', nullable: false })
  fieldId: string;

  @ManyToOne('CustomTrackingFieldEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fieldId' })
  field: CustomTrackingFieldEntity;

  @ApiProperty({
    description:
      'Whether this answers an Account or a Character. Matched against the Field’s own scope by the database.',
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
    description: 'The STO Account answered for, when the scope is ACCOUNT.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  accountId: string | null;

  @ManyToOne('AccountEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: AccountEntity | null;

  @ApiProperty({
    description: 'The STO Character answered for, when the scope is CHARACTER.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  characterId: string | null;

  @ManyToOne('CharacterEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'characterId' })
  character: CharacterEntity | null;

  /**
   * The answer itself.
   *
   * Withheld from the audit trail. This is content a user wrote about their own
   * account or character, and copying it into a second table with its own
   * retention period would mean deleting the original left the copy behind.
   * The trail still records that the value changed, who changed it and when,
   * which is what an investigation actually needs.
   */
  @ApiProperty({
    description: 'The typed answer, shaped by the Field’s type.',
    nullable: true,
  })
  @RedactFromAudit()
  @Column({ type: 'jsonb', nullable: true, default: null })
  value: CustomTrackingValue | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
