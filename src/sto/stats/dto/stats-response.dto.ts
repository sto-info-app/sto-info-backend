import { ApiProperty } from '@nestjs/swagger';

export class CountItemDto {
  @ApiProperty({ example: 'Human' })
  name: string;

  @ApiProperty({ example: 5 })
  count: number;
}

export class StatsResponseDto {
  @ApiProperty({ example: 3 })
  accountCount: number;

  @ApiProperty({ example: 1 })
  lifetimeSubCount: number;

  @ApiProperty({ example: 12 })
  characterCount: number;

  @ApiProperty({ example: 60 })
  avgLevel: number;

  @ApiProperty({ example: 10 })
  minLevel: number;

  @ApiProperty({ example: 65 })
  maxLevel: number;

  @ApiProperty({ type: [CountItemDto] })
  bySpecies: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  byGeneralFaction: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  byFaction: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  byClass: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  bySex: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  byRecruitType: CountItemDto[];

  @ApiProperty({
    description:
      'Character count per level range tier, sorted ascending by level. ' +
      'Tier boundaries are sourced from the Starfleet (2409) rank table. ' +
      'Names are formatted as "Level X - Y" or "Level X" when levelFrom equals levelTo. ' +
      'All tiers are always present even if count is 0.',
    type: [CountItemDto],
  })
  byLevelRange: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  byPlatform: CountItemDto[];

  @ApiProperty({ type: [CountItemDto] })
  byLauncher: CountItemDto[];

  @ApiProperty({ example: 250 })
  endeavourTotalNodes: number;

  @ApiProperty({ example: 500 })
  endeavourMaxNodes: number;

  @ApiProperty({
    description:
      'Total nodes earned per endeavour perk, summed across all accounts in scope. ' +
      'All known perks are present even if count is 0.',
    type: [CountItemDto],
  })
  byEndeavourPerk: CountItemDto[];

  @ApiProperty({
    description:
      'Average nodes earned per account per endeavour perk (0–25 scale). ' +
      'All known perks are present even if count is 0.',
    type: [CountItemDto],
  })
  byEndeavourPerkAvg: CountItemDto[];

  @ApiProperty({
    description:
      'Total nodes earned per endeavour category (Space / Ground), ' +
      'summed across all accounts in scope.',
    type: [CountItemDto],
  })
  byEndeavourCategory: CountItemDto[];

  @ApiProperty({
    description:
      'Completion percentage per endeavour category (Space / Ground), ' +
      'averaged across all accounts in scope. Values are 0–100.',
    type: [CountItemDto],
  })
  byEndeavourCategoryPct: CountItemDto[];
}
