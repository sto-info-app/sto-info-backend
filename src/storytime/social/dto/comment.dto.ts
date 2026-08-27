import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { StorytimeCommentStatus } from '../../enums/storytime-comment-status.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/** The longest a comment may be. */
export const MAX_COMMENT_LENGTH = 2000;

/** Trims a string value, leaving anything else for the validators. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Posts a comment, or a reply to one.
 */
export class CreateCommentDto {
  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of thing is being commented on.',
  })
  @IsEnum(StorytimeTargetType)
  readonly targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The thing being commented on.' })
  @IsUUID()
  readonly targetId: string;

  @ApiProperty({
    description: 'What the commenter has to say, as plain text.',
    maxLength: MAX_COMMENT_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_COMMENT_LENGTH)
  readonly body: string;

  @ApiPropertyOptional({
    description: 'The comment being replied to. Replies go one level deep.',
  })
  @IsOptional()
  @IsUUID()
  readonly parentCommentId?: string;
}

/**
 * Changes what a comment says.
 */
export class UpdateCommentDto {
  @ApiProperty({
    description: 'What it should say.',
    maxLength: MAX_COMMENT_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_COMMENT_LENGTH)
  readonly body: string;
}

/**
 * Removes a comment under the content policy.
 */
export class RemoveCommentDto {
  @ApiProperty({
    description: 'What the author is told, word for word.',
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  readonly message: string;
}

/**
 * A comment as a reader sees it.
 *
 * A silenced comment keeps its place in the thread but not its words. What is
 * left says who silenced it, because "removed by an administrator" and
 * "deleted by its author" mean different things to somebody reading a reply
 * to it.
 */
export class CommentDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'Who wrote it.' })
  authorUserId: string;

  @ApiProperty({
    description: 'The comment this replies to, if any.',
    nullable: true,
  })
  parentCommentId: string | null;

  @ApiProperty({
    description: 'What they said, or null when it has been silenced.',
    nullable: true,
  })
  body: string | null;

  @ApiProperty({
    enum: StorytimeCommentStatus,
    description: 'Whether it is shown, and who stopped it being shown.',
  })
  status: StorytimeCommentStatus;

  @ApiProperty({
    description: 'When the author last changed it.',
    nullable: true,
  })
  editedAt: Date | null;

  @ApiProperty({ description: 'When it was posted.' })
  createdAt: Date;
}
