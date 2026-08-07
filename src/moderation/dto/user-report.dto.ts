import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReason } from '../enums/report-reason.enum';
import { ReportStatus } from '../enums/report-status.enum';

/**
 * One side of a report as the admin queue shows it.
 *
 * Carries the user ID as well as the username because moderation acts on the
 * account, not the public record — a reported member may have closed their
 * profile, and the disable action still has to reach them.
 */
export class ReportPartyDto {
  @ApiProperty({ description: 'The member’s user ID.' })
  userId: string;

  @ApiPropertyOptional({
    description:
      'The member’s profile username, or null when they have no profile.',
    nullable: true,
  })
  username: string | null;

  @ApiPropertyOptional({
    description: 'The member’s avatar, or null when they have not set one.',
    nullable: true,
  })
  profilePicture100: string | null;

  @ApiProperty({
    description: 'Whether the member’s account is currently disabled.',
  })
  isAccountDisabled: boolean;
}

/**
 * A report as presented to administrators.
 *
 * Only ever returned to administrators: reporters get no read endpoint, and the
 * reported member is never told a report exists, let alone who raised it.
 */
export class UserReportDto {
  @ApiProperty({ description: 'Report ID.' })
  id: string;

  @ApiProperty({ description: 'The member who raised the report.' })
  reporter: ReportPartyDto;

  @ApiProperty({ description: 'The member the report is about.' })
  reported: ReportPartyDto;

  @ApiProperty({ description: 'The category the reporter chose.' })
  reason: ReportReason;

  @ApiPropertyOptional({
    description: 'The reporter’s own account of what happened.',
    nullable: true,
  })
  details: string | null;

  @ApiProperty({ description: 'Where the report sits in the queue.' })
  status: ReportStatus;

  @ApiPropertyOptional({
    description: 'Internal notes left by the reviewing administrator.',
    nullable: true,
  })
  moderatorNotes: string | null;

  @ApiPropertyOptional({
    description:
      'The username of the administrator who last changed the status.',
    nullable: true,
  })
  reviewedBy: string | null;

  @ApiPropertyOptional({
    description: 'When the status was last changed.',
    nullable: true,
  })
  reviewedAt: Date | null;

  @ApiProperty({ description: 'When the report was raised.' })
  createdAt: Date;
}

/**
 * A page of reports.
 */
export class PaginatedReportsDto {
  @ApiProperty({
    description: 'The reports on this page.',
    type: [UserReportDto],
  })
  items: UserReportDto[];

  @ApiProperty({ description: 'Total reports matching the query.' })
  total: number;

  @ApiProperty({ description: 'The 1-based page number.' })
  page: number;

  @ApiProperty({ description: 'Items per page.' })
  pageSize: number;

  @ApiProperty({
    description:
      'How many reports are still unresolved across the whole queue, ' +
      'regardless of the filter applied.',
  })
  openCount: number;
}
