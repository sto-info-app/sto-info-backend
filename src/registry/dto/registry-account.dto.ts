import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RegistryCharacterSummaryDto } from './registry-character.dto';

/**
 * Public summary of an STO account, as listed on a profile's registry page.
 *
 * Deliberately omits `email`, `username` (the launcher account name), `notes`,
 * `id` and `userId`.
 */
export class RegistryAccountSummaryDto {
  @ApiProperty({ example: 'SteveX#1234' })
  handle: string;

  @ApiProperty({
    description:
      "URL segment identifying this account within its owner's profile.",
    example: 'SteveX~1234',
  })
  slug: string;

  @ApiPropertyOptional({ example: 'Steam', nullable: true })
  platformName: string | null;

  @ApiPropertyOptional({ example: 'Arc', nullable: true })
  launcherName: string | null;

  @ApiProperty({
    description: 'Resolved card background image for the account.',
    example: 'https://imagedelivery.net/hash/image-id/public',
  })
  accountTypeImageUrl: string;

  @ApiProperty({ example: false })
  lifetimeSubscription: boolean;

  @ApiPropertyOptional({
    description: 'When the STO account was created, if the owner recorded it.',
    nullable: true,
  })
  accountCreatedDate: Date | null;

  @ApiProperty({
    description: 'Number of publicly visible captains on this account.',
    example: 5,
  })
  publicCharacterCount: number;
}

/**
 * Public detail view of an STO account, including its visible captains.
 */
export class RegistryAccountDto extends RegistryAccountSummaryDto {
  @ApiProperty({ type: [RegistryCharacterSummaryDto] })
  characters: RegistryCharacterSummaryDto[];
}
