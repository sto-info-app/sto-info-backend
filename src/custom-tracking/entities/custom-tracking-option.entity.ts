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

import { CustomTrackingFieldEntity } from './custom-tracking-field.entity';

/**
 * One of the answers a choice or tags Field offers.
 *
 * Values reference an option by its identifier, never by its label. That is
 * what lets a label be corrected without rewriting every value that chose it,
 * and what lets a deleted option keep displaying the wording it had.
 *
 * Deletion is soft and stays soft for as long as anything points here. A
 * deleted option cannot be newly chosen, but a value that already chose it
 * goes on reading correctly, and a user editing that value may keep the
 * selection or replace it. The retention job leaves such an option alone even
 * past its own hundred and eighty days, and the foreign key from the value
 * table would refuse the deletion in any case — the schema is the guarantee,
 * and the job's check is the courtesy that stops it having to fail.
 *
 * `isDefault` lives here rather than as an identifier inside the Field's JSON
 * configuration. A default is a reference to an option, and a reference the
 * database can see is one it can keep honest; one buried in a JSON document
 * would survive the option it names.
 */
@Entity({ name: 'custom_tracking_option' })
@Index(
  'UX_custom_tracking_option_field_label',
  ['fieldId', 'labelNormalized'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@Index('IDX_custom_tracking_option_field_order', ['fieldId', 'orderIndex'])
export class CustomTrackingOptionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Field offering this option.' })
  @Column({ type: 'uuid', nullable: false })
  fieldId: string;

  @ManyToOne('CustomTrackingFieldEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fieldId' })
  field: CustomTrackingFieldEntity;

  @ApiProperty({ description: 'The wording offered to whoever is answering.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  label: string;

  @ApiProperty({
    description:
      'The label lower-cased, so sibling labels are unique without regard to case.',
  })
  @Column({ type: 'varchar', length: 100, nullable: false })
  labelNormalized: string;

  @ApiProperty({ description: 'Position among its siblings.' })
  @Column({ type: 'integer', nullable: false })
  orderIndex: number;

  @ApiProperty({
    description:
      'Whether an editor with no value starts with this option chosen.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
