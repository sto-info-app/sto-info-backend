import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RedactFromAudit } from 'src/audit/audit-redaction';

import { CustomTrackingImageShape } from '../enums/custom-tracking-image-shape.enum';
import { CustomTrackingValueEntity } from './custom-tracking-value.entity';

/**
 * The picture answering one image Field, for one Account or Character.
 *
 * A table of its own rather than an identifier inside the value's JSON,
 * because a picture has a lifecycle the rest of a value does not: it lives in
 * Cloudflare as well as here, it has to be released when it is replaced or
 * removed, and something has to be able to find the ones that were orphaned
 * when a release failed. A column the database can index and a reconciliation
 * job can read is what makes that possible.
 *
 * One picture per value, enforced by a unique key on the value rather than by
 * a service that remembers to check. Replacing one uploads and validates the
 * new picture before the old reference is released, so a failed upload leaves
 * the existing picture in place rather than leaving the Field empty.
 */
@Entity({ name: 'custom_tracking_image_value' })
@Index('UX_custom_tracking_image_value_value', ['valueId'], { unique: true })
@Index('IDX_custom_tracking_image_value_image', ['cloudflareImageId'])
export class CustomTrackingImageValueEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The value this picture answers.' })
  @Column({ type: 'uuid', nullable: false })
  valueId: string;

  @OneToOne('CustomTrackingValueEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'valueId' })
  value: CustomTrackingValueEntity;

  /**
   * The Cloudflare Images identifier.
   *
   * Never returned to an anonymous caller unless the whole visibility chain
   * has passed. A delivery URL is a capability: anybody holding one can fetch
   * the picture without passing any check this application makes.
   */
  @ApiProperty({ description: 'Cloudflare Images identifier.' })
  @Column({ type: 'varchar', length: 160, nullable: false })
  cloudflareImageId: string;

  /**
   * What the picture shows.
   *
   * Required whenever a picture exists, and withheld from the audit trail for
   * the same reason the value itself is: it is a sentence the user wrote.
   */
  @ApiProperty({ description: 'Alternative text describing the picture.' })
  @RedactFromAudit()
  @Column({ type: 'varchar', length: 300, nullable: false })
  altText: string;

  @ApiProperty({
    description:
      'The shape it was cropped to, copied from the Field so a later change to the Field does not misdescribe a picture already stored.',
    enum: CustomTrackingImageShape,
  })
  @Column({
    type: 'enum',
    enum: CustomTrackingImageShape,
    enumName: 'custom_tracking_image_shape_enum',
    nullable: false,
  })
  shape: CustomTrackingImageShape;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
