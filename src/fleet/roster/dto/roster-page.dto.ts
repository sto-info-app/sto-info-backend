import { ApiProperty } from '@nestjs/swagger';

import { RosterProfession } from '../../imports/enums/roster-profession.enum';

/** One effective export, as a roster reader steps between them. */
export class RosterExportRefDto {
  @ApiProperty({ description: 'The import the export arrived as.' })
  importId: string;

  @ApiProperty({ description: 'The instant the export was taken.' })
  exportedAt: Date;
}

/** The export a roster page shows, and the ones either side of it. */
export class RosterExportDto extends RosterExportRefDto {
  @ApiProperty({
    description:
      'Whether it was marked partial: somebody missing from it may still ' +
      'have been a member.',
  })
  partial: boolean;

  @ApiProperty({ type: RosterExportRefDto, nullable: true })
  previous: RosterExportRefDto | null;

  @ApiProperty({ type: RosterExportRefDto, nullable: true })
  next: RosterExportRefDto | null;
}

/** Which effective exports the published revision covers. */
export class RosterCoverageDto {
  @ApiProperty({ description: 'How many effective exports it has.' })
  exports: number;

  @ApiProperty({ type: RosterExportRefDto, nullable: true })
  first: RosterExportRefDto | null;

  @ApiProperty({ type: RosterExportRefDto, nullable: true })
  latest: RosterExportRefDto | null;
}

/** A rank label on the export shown, and how many rows hold it. */
export class RosterRankCountDto {
  @ApiProperty({ description: 'The label, exactly as the export lists it.' })
  label: string;

  @ApiProperty({
    description: 'Its tier in the Fleet’s rank order, 1 the highest.',
    nullable: true,
  })
  tier: number | null;

  @ApiProperty({ description: 'How many rows on the export hold it.' })
  members: number;
}

/**
 * Where a row's Character has a registry page the viewer may open.
 *
 * Present only when the Character's owner has recorded its membership of
 * the Fleet for the export's moment, that membership's audience includes the
 * viewer, and the registry would show the viewer the Character's page.
 */
export class RosterProfileLinkDto {
  @ApiProperty({ description: 'The owning member’s profile username.' })
  username: string;

  @ApiProperty({ description: 'The owning account’s URL slug.' })
  accountSlug: string;

  @ApiProperty({ description: 'The Character’s URL slug.' })
  characterSlug: string;
}

/**
 * One row of an export, as a roster reader sees it.
 *
 * Never an officer field: plan R10 discards them before anything is stored.
 */
export class RosterRowDto {
  @ApiProperty({ description: 'The row’s line in the sanitised file.' })
  line: number;

  @ApiProperty({
    description: 'The member the row belongs to, across renames.',
    nullable: true,
  })
  identityId: string | null;

  @ApiProperty({
    description:
      'How many rows on this export belong to the same member. More than one ' +
      'when a confirmed rename left both names listed.',
  })
  identityRows: number;

  @ApiProperty()
  characterName: string;

  @ApiProperty({
    description:
      'The account handle, which tells apart two Characters on one account.',
  })
  accountHandle: string;

  @ApiProperty()
  level: number;

  @ApiProperty()
  className: string;

  @ApiProperty({ enum: RosterProfession, nullable: true })
  profession: RosterProfession | null;

  @ApiProperty({ description: 'The Fleet’s own rank label.' })
  guildRank: string;

  @ApiProperty({
    description: 'The label’s tier in the Fleet’s rank order, 1 the highest.',
    nullable: true,
  })
  rankTier: number | null;

  @ApiProperty({
    description: 'The cumulative contribution, as a decimal string.',
  })
  contributionTotal: string;

  @ApiProperty({ nullable: true })
  joinedAt: Date | null;

  @ApiProperty({
    description: 'Whether the Join Date fell in the hour a clock went back.',
  })
  joinedAtAmbiguous: boolean;

  @ApiProperty({ nullable: true })
  rankChangedAt: Date | null;

  @ApiProperty()
  rankChangedAtAmbiguous: boolean;

  @ApiProperty({ nullable: true })
  lastActiveAt: Date | null;

  @ApiProperty()
  lastActiveAtAmbiguous: boolean;

  @ApiProperty()
  status: string;

  @ApiProperty()
  publicComment: string;

  @ApiProperty({ nullable: true })
  publicCommentEditedAt: Date | null;

  @ApiProperty({
    description:
      'Whether an investigator excluded the row. Only investigators are ' +
      'shown excluded rows at all.',
  })
  excluded: boolean;

  @ApiProperty({ type: RosterProfileLinkDto, nullable: true })
  profile: RosterProfileLinkDto | null;
}

/** A page of a Fleet's roster, as one export listed it (FC-020). */
export class RosterPageDto {
  @ApiProperty({ description: 'The revision read. 0 before the first.' })
  revision: number;

  @ApiProperty({ nullable: true })
  publishedAt: Date | null;

  @ApiProperty({
    description: 'Whether a change is waiting for a newer revision.',
  })
  stale: boolean;

  @ApiProperty({ type: RosterCoverageDto })
  coverage: RosterCoverageDto;

  @ApiProperty({
    type: RosterExportDto,
    nullable: true,
    description: 'The export shown, or null when none is at or before asOf.',
  })
  export: RosterExportDto | null;

  @ApiProperty({ type: [RosterRankCountDto] })
  ranks: RosterRankCountDto[];

  @ApiProperty({ type: [RosterRowDto] })
  items: RosterRowDto[];

  @ApiProperty({ description: 'How many rows match, across every page.' })
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}
