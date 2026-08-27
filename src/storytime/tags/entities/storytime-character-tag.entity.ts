import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A tag attached to a Character.
 *
 * Its own table rather than a shared polymorphic one, so the foreign key is
 * real: deleting a Character takes its tags with it and nothing has to remember
 * to tidy up afterwards.
 */
@Entity({ name: 'storytime_character_tag' })
@Index(['tagId'])
export class StorytimeCharacterTagEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The Character that is tagged.' })
  @Column({ type: 'uuid', nullable: false })
  characterId: string;

  @ApiProperty({ description: 'The tag.' })
  @Column({ type: 'uuid', nullable: false })
  tagId: string;

  @CreateDateColumn()
  createdAt: Date;
}
