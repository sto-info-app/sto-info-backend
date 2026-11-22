import { ApiProperty } from '@nestjs/swagger';

import { RosterRankCountDto } from 'src/fleet/roster/dto/roster-page.dto';

/**
 * One row of an import, as an investigator choosing rows to exclude sees it
 * (FC-020).
 *
 * Enough to tell the rows apart and judge them; never an officer field,
 * which was discarded before anything was stored.
 */
export class RosterImportRowDto {
  @ApiProperty({ description: 'Its line in the sanitised file, header as 1.' })
  line: number;

  @ApiProperty()
  characterName: string;

  @ApiProperty()
  accountHandle: string;

  @ApiProperty()
  guildRank: string;

  @ApiProperty()
  level: number;

  @ApiProperty({ description: 'As a decimal string.' })
  contributionTotal: string;

  @ApiProperty({ nullable: true })
  joinedAt: Date | null;

  @ApiProperty({ nullable: true })
  lastActiveAt: Date | null;

  @ApiProperty({ description: 'Whether an investigator excluded it.' })
  excluded: boolean;
}

/**
 * A page of an import's rows, in the order and within the filters asked for
 * (FC-055); in line order when nothing was asked.
 */
export class RosterImportRowPageDto {
  @ApiProperty({ type: [RosterImportRowDto] })
  items: RosterImportRowDto[];

  @ApiProperty({
    type: [RosterRankCountDto],
    description:
      'Each rank label the import’s rows hold, with how many hold it, for ' +
      'the Rank filter; across the whole import, whatever the filters.',
  })
  ranks: RosterRankCountDto[];

  @ApiProperty({ description: 'How many rows match, across every page.' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}
