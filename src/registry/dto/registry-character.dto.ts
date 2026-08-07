import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A named reference value (species, class, faction, ...) with its icon.
 */
export class RegistryLookupDto {
  @ApiProperty({ example: 'Vulcan' })
  name: string;

  @ApiPropertyOptional({
    description:
      'Icon URL, or null when none is set or the stored URL is invalid.',
    example: 'https://imagedelivery.net/hash/image-id/public',
    nullable: true,
  })
  iconUrl: string | null;
}

/**
 * A captain's rank, derived from their level and starting faction.
 */
export class RegistryRankDto {
  @ApiProperty({ example: 'Vice Admiral' })
  title: string;

  @ApiPropertyOptional({ nullable: true })
  iconUrl: string | null;

  @ApiProperty({ example: 'Level 50 - 59' })
  levelRange: string;
}

/**
 * Public summary of a captain, as listed on an account's registry page.
 *
 * Deliberately omits `notes`, `id` and `accountId`.
 */
export class RegistryCharacterSummaryDto {
  @ApiProperty({ example: 'Rex' })
  handle: string;

  @ApiProperty({
    description: 'URL segment identifying this captain within its account.',
    example: 'Rex@SteveX~1234',
  })
  slug: string;

  @ApiPropertyOptional({ example: 65, nullable: true })
  level: number | null;

  @ApiPropertyOptional({ type: RegistryRankDto, nullable: true })
  rank: RegistryRankDto | null;

  @ApiPropertyOptional({ type: RegistryLookupDto, nullable: true })
  species: RegistryLookupDto | null;

  @ApiPropertyOptional({ type: RegistryLookupDto, nullable: true })
  class: RegistryLookupDto | null;

  @ApiPropertyOptional({ type: RegistryLookupDto, nullable: true })
  sex: RegistryLookupDto | null;

  @ApiPropertyOptional({ type: RegistryLookupDto, nullable: true })
  faction: RegistryLookupDto | null;

  @ApiPropertyOptional({ type: RegistryLookupDto, nullable: true })
  generalFaction: RegistryLookupDto | null;

  @ApiPropertyOptional({ type: RegistryLookupDto, nullable: true })
  recruitType: RegistryLookupDto | null;

  @ApiPropertyOptional({ nullable: true })
  profilePicture100: string | null;

  @ApiPropertyOptional({ nullable: true })
  profilePicture300: string | null;
}

/**
 * Public detail view of a captain.
 *
 * Adds the in-character name, biography and creation date to the summary. The
 * owner's private `notes` field is never included.
 */
export class RegistryCharacterDto extends RegistryCharacterSummaryDto {
  @ApiPropertyOptional({ nullable: true })
  firstName: string | null;

  @ApiPropertyOptional({ nullable: true })
  middleName: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastName: string | null;

  @ApiPropertyOptional({ nullable: true })
  biography: string | null;

  @ApiPropertyOptional({ nullable: true })
  createdDate: Date | null;
}
