import { ApiProperty } from '@nestjs/swagger';

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

/** A page of an import's rows, in line order. */
export class RosterImportRowPageDto {
  @ApiProperty({ type: [RosterImportRowDto] })
  items: RosterImportRowDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}
