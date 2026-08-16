import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A role somebody may be credited in.
 *
 * A lookup table rather than an enum, because this is a taxonomy an
 * administrator may extend: a community that starts producing audio drama will
 * want roles nobody thought of when this was written.
 *
 * The seeded roles are marked `isSystem` so they cannot be deleted out from
 * under the credits already pointing at them.
 */
@Entity({ name: 'storytime_crew_role' })
export class StorytimeCrewRoleEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Stable code, unique across roles.' })
  @Column({ type: 'varchar', length: 50, nullable: false })
  code: string;

  @ApiProperty({ description: 'How the role is shown in credits.' })
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @ApiProperty({ description: 'What the role means.', nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true, default: null })
  description: string | null;

  @ApiProperty({ description: 'Position in a credits roll.' })
  @Column({ type: 'integer', nullable: false, default: 0 })
  displayOrder: number;

  @ApiProperty({
    description:
      'Whether the site ships with this role. System roles cannot be deleted.',
  })
  @Column({ type: 'boolean', nullable: false, default: false })
  isSystem: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
