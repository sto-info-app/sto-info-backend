import { ApiProperty } from '@nestjs/swagger';

import { UserRole } from 'src/user/enums/user-role.enum';

/**
 * One count over the four windows the Site Statistics page shows (FC-053).
 *
 * Each window counts the rows whose date falls within it: since the start of
 * today (UTC), the last seven days, the last thirty days, and ever.
 */
export class CountWindowsDto {
  @ApiProperty({ example: 2, description: 'Since 00:00 UTC today.' })
  today: number;

  @ApiProperty({ example: 9, description: 'In the last seven days.' })
  last7Days: number;

  @ApiProperty({ example: 31, description: 'In the last thirty days.' })
  last30Days: number;

  @ApiProperty({ example: 412, description: 'Ever.' })
  allTime: number;
}

/** How many users hold a role. */
export class RoleCountDto {
  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ example: 400 })
  count: number;
}

/** One week of a series, keyed by the Monday it starts on. */
export class WeeklyCountDto {
  @ApiProperty({
    example: '2026-10-19',
    description: 'The Monday the week starts on, as a date.',
  })
  weekStarting: string;

  @ApiProperty({ example: 7 })
  count: number;
}

/** The site's users. */
export class UserStatisticsDto {
  @ApiProperty({ example: 412, description: 'Open accounts.' })
  total: number;

  @ApiProperty({
    example: 380,
    description: 'Open accounts whose email address is verified.',
  })
  verified: number;

  @ApiProperty({
    example: 3,
    description: 'Open accounts a site admin has disabled.',
  })
  disabled: number;

  @ApiProperty({
    example: 12,
    description:
      'Accounts closed and awaiting their final deletion. An account deleted for good is no longer counted anywhere.',
  })
  closed: number;

  @ApiProperty({
    type: [RoleCountDto],
    description: 'Open accounts by role; every role is present.',
  })
  byRole: RoleCountDto[];

  @ApiProperty({
    type: CountWindowsDto,
    description:
      'Accounts registered, closed ones included, so the figure stands for sign-ups rather than for who stayed.',
  })
  registrations: CountWindowsDto;

  @ApiProperty({
    type: CountWindowsDto,
    description:
      'Open, enabled accounts last seen in the window, by lastSeenAt or, for an account not seen since that was recorded, by lastLoginAt. All time counts the accounts ever seen.',
  })
  active: CountWindowsDto;
}

/** Storytime, counting what is live and what was newly published. */
export class StorytimeStatisticsDto {
  @ApiProperty({
    type: CountWindowsDto,
    description:
      'Published Stories by when they were first published; all time is how many are live.',
  })
  storiesPublished: CountWindowsDto;

  @ApiProperty({ type: CountWindowsDto, description: 'Likewise, Chapters.' })
  chaptersPublished: CountWindowsDto;

  @ApiProperty({ type: CountWindowsDto, description: 'Likewise, Arcs.' })
  arcsPublished: CountWindowsDto;

  @ApiProperty({ example: 4, description: 'Spotlights published now.' })
  spotlightsLive: number;

  @ApiProperty({
    type: CountWindowsDto,
    description: 'Comments made, whether or not they still show.',
  })
  comments: CountWindowsDto;
}

/** One kind of Fleet scope: Communities, Fleets or Armadas. */
export class ScopeStatisticsDto {
  @ApiProperty({
    example: 14,
    description: 'Registered and active now: not suspended, closed or deleted.',
  })
  active: number;

  @ApiProperty({
    type: CountWindowsDto,
    description: 'Registered, by when; deleted ones are not counted.',
  })
  registered: CountWindowsDto;
}

/** Fleet Communities and chat. */
export class FleetStatisticsDto {
  @ApiProperty({ type: ScopeStatisticsDto })
  communities: ScopeStatisticsDto;

  @ApiProperty({ type: ScopeStatisticsDto })
  fleets: ScopeStatisticsDto;

  @ApiProperty({ type: ScopeStatisticsDto })
  armadas: ScopeStatisticsDto;

  @ApiProperty({
    example: 120,
    description:
      'Users holding approved access to at least one Community, Fleet or Armada, each counted once.',
  })
  members: number;

  @ApiProperty({
    type: CountWindowsDto,
    description: 'Chat messages sent, removed ones included.',
  })
  chatMessages: CountWindowsDto;

  @ApiProperty({
    type: CountWindowsDto,
    description: 'Applications to join a Fleet, by when they were submitted.',
  })
  applications: CountWindowsDto;

  @ApiProperty({
    type: CountWindowsDto,
    description: 'Events created, cancelled ones included.',
  })
  events: CountWindowsDto;
}

/** Reports still waiting on a site admin. */
export class OpenReportsDto {
  @ApiProperty({ example: 2, description: 'Reports about a member.' })
  members: number;

  @ApiProperty({ example: 1, description: 'Reports of a chat message.' })
  chat: number;

  @ApiProperty({ example: 3 })
  total: number;
}

/** STO records, the site's news and the moderation queues. */
export class SiteContentStatisticsDto {
  @ApiProperty({
    type: CountWindowsDto,
    description:
      'STO accounts recorded, by when; deleted ones are not counted.',
  })
  stoAccounts: CountWindowsDto;

  @ApiProperty({ type: CountWindowsDto, description: 'Likewise, Characters.' })
  stoCharacters: CountWindowsDto;

  @ApiProperty({
    type: CountWindowsDto,
    description:
      "The site's own news posts, by when they were published; Fleet news is not counted.",
  })
  newsPublished: CountWindowsDto;

  @ApiProperty({ type: OpenReportsDto })
  openReports: OpenReportsDto;
}

/** Everything the Site Statistics page shows, read in one go (FC-053). */
export class SiteStatisticsDto {
  @ApiProperty({ description: 'When these numbers were read.' })
  generatedAt: Date;

  @ApiProperty({ type: UserStatisticsDto })
  users: UserStatisticsDto;

  @ApiProperty({
    type: [WeeklyCountDto],
    description:
      'Accounts registered in each of the last twelve weeks, oldest first, closed ones included.',
  })
  registrationsByWeek: WeeklyCountDto[];

  @ApiProperty({
    type: [WeeklyCountDto],
    description:
      'Open, enabled accounts by the week they were last seen in, over the last twelve weeks, oldest first. An account counts in one week only: the latest it was seen.',
  })
  lastSeenByWeek: WeeklyCountDto[];

  @ApiProperty({ type: StorytimeStatisticsDto })
  storytime: StorytimeStatisticsDto;

  @ApiProperty({ type: FleetStatisticsDto })
  fleet: FleetStatisticsDto;

  @ApiProperty({ type: SiteContentStatisticsDto })
  content: SiteContentStatisticsDto;
}
