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
}
