import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { StorytimeReaction } from '../../enums/storytime-reaction.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * One reader's reaction to one thing.
 *
 * At most one per person per item: changing your mind is an update rather than
 * a second vote, which is what stops the counts on a Story drifting from the
 * rows that justify them.
 */
@Entity({ name: 'storytime_reaction' })
@Unique(['userId', 'targetType', 'targetId'])
@Index(['targetType', 'targetId'])
export class StorytimeReactionEntity {
  @ApiProperty({ description: 'Unique identifier.' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'The reader.' })
  @Column({ type: 'uuid', nullable: false })
  userId: string;

  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of thing they reacted to.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeTargetType,
    enumName: 'storytime_target_type_enum',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The thing they reacted to.' })
  @Column({ type: 'uuid', nullable: false })
  targetId: string;

  @ApiProperty({
    enum: StorytimeReaction,
    description: 'What they thought of it.',
  })
  @Column({
    type: 'enum',
    enum: StorytimeReaction,
    enumName: 'storytime_reaction_enum',
  })
  reaction: StorytimeReaction;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
