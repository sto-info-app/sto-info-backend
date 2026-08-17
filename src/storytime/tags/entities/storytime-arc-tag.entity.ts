import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A tag attached to a Arc.
 *
 * Its own table rather than a shared polymorphic one, so the foreign key is
 * real: deleting a Arc takes its tags with it and nothing has to remember
 * to tidy up afterwards.
 */
@Entity({ name: 'storytime_arc_tag' })
@Index(['tagId'])
export class StorytimeArcTagEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Arc that is tagged.' })
  @Column({ type: 'uuid', nullable: false })
  arcId: string;

  @ApiProperty({ description: 'The tag.' })
  @Column({ type: 'uuid', nullable: false })
  tagId: string;

  @CreateDateColumn()
  createdAt: Date;
}
