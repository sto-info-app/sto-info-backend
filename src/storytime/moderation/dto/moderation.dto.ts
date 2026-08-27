import { ApiProperty } from '@nestjs/swagger';
import { ReportStatus } from '../../../moderation/enums/report-status.enum';
import { AppealStatus } from '../../enums/appeal-status.enum';
import { StorytimeModerationAction } from '../../enums/storytime-moderation-action.enum';
import { StorytimeReportReason } from '../../enums/storytime-report-reason.enum';
import { StorytimeTargetType } from '../../enums/storytime-target-type.enum';

/**
 * A report as its reporter sees it back.
 *
 * Carries nothing about the administrator handling it. A reporter is told
 * their report was received and later that it was dealt with; what was decided
 * about somebody else's work is not theirs to read.
 */
export class StorytimeReportReceiptDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ enum: StorytimeTargetType, description: 'What was reported.' })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content reported.' })
  targetId: string;

  @ApiProperty({ enum: ReportStatus, description: 'Where it has got to.' })
  status: ReportStatus;

  @ApiProperty({ description: 'When it was raised.' })
  createdAt: Date;
}

/**
 * A report as the moderation queue shows it.
 */
export class StorytimeReportDto extends StorytimeReportReceiptDto {
  @ApiProperty({ description: 'The member who raised it.' })
  reporterUserId: string;

  @ApiProperty({
    enum: StorytimeReportReason,
    description: 'The policy category chosen.',
  })
  reasonCode: StorytimeReportReason;

  @ApiProperty({ description: 'What the reporter added.', nullable: true })
  description: string | null;

  @ApiProperty({
    description: 'The administrator who claimed it.',
    nullable: true,
  })
  assignedToUserId: string | null;

  @ApiProperty({ description: 'What was decided.', nullable: true })
  resolution: string | null;

  @ApiProperty({ description: 'When it was resolved.', nullable: true })
  resolvedAt: Date | null;
}

/**
 * One entry in a piece of content's moderation history.
 */
export class ModerationActionDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ enum: StorytimeTargetType, description: 'What was acted on.' })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The content acted on.' })
  targetId: string;

  @ApiProperty({
    enum: StorytimeModerationAction,
    description: 'What was done.',
  })
  action: StorytimeModerationAction;

  @ApiProperty({ description: 'The administrator who did it.' })
  actorUserId: string;

  @ApiProperty({ description: 'The policy code cited.', nullable: true })
  reasonCode: string | null;

  @ApiProperty({ description: 'What was said.', nullable: true })
  message: string | null;

  @ApiProperty({ description: 'When it happened.' })
  createdAt: Date;
}

/**
 * An appeal, as both its author and the queue see it.
 *
 * The same shape serves both: there is nothing in an appeal that its author
 * did not write or is not entitled to read back.
 */
export class ModerationAppealDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({
    enum: StorytimeTargetType,
    description: 'What kind of content was removed.',
  })
  targetType: StorytimeTargetType;

  @ApiProperty({ description: 'The removed content.' })
  targetId: string;

  @ApiProperty({ description: 'The creator appealing.' })
  appellantUserId: string;

  @ApiProperty({ description: 'What they had to say.' })
  body: string;

  @ApiProperty({ enum: AppealStatus, description: 'Where it has got to.' })
  status: AppealStatus;

  @ApiProperty({ description: 'What the administrator said.', nullable: true })
  reviewNotes: string | null;

  @ApiProperty({ description: 'When it was decided.', nullable: true })
  reviewedAt: Date | null;

  @ApiProperty({ description: 'When it was raised.' })
  createdAt: Date;
}
