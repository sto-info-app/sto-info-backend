import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { StorytimeReaction } from '../../enums/storytime-reaction.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * Records what a reader thinks of something.
 *
 * Sending the same reaction again takes it back, because that is what a
 * pressed button means when it is pressed a second time.
 */
export class ReactDto {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of thing is being reacted to.',
  })
  @IsEnum(StorytimeTargetType)
  readonly targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The thing being reacted to.' })
  @IsUUID()
  readonly targetId: string;

  @ApiProperty({
    enum: StorytimeReaction,
    description: 'What the reader thought of it.',
  })
  @IsEnum(StorytimeReaction)
  readonly reaction: StorytimeReaction;
}

/**
 * How a thing stands, and what this reader chose.
 */
export class ReactionSummaryDto {
  @ApiProperty({ description: 'The thing reacted to.' })
  targetId: string;

  @ApiProperty({ description: 'How many thumbs up it has.' })
  upVotes: number;

  @ApiProperty({ description: 'How many thumbs down.' })
  downVotes: number;

  @ApiProperty({ description: 'Up minus down, which is the number shown.' })
  rating: number;

  @ApiProperty({
    enum: StorytimeReaction,
    description: 'What this reader chose, if anything.',
    nullable: true,
  })
  mine: StorytimeReaction | null;
}
