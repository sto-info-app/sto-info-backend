import { ApiProperty } from '@nestjs/swagger';

/**
 * One captain as the quick-switch list needs it.
 *
 * Deliberately far smaller than the full captain payload: the switcher shows a
 * row and navigates away from it, so everything it does not draw — biography,
 * notes, species, class, rank, the lookup rows behind them — is left out. A
 * user with a dozen accounts of fifty captains each would otherwise pull the
 * whole dashboard down to open a list.
 */
export class AccountSwitcherCharacterDto {
  @ApiProperty({ description: 'The captain ID.' })
  id: string;

  @ApiProperty({
    description: 'The captain handle, which also addresses them in the URL.',
    example: 'Kaelith',
  })
  handle: string;

  @ApiProperty({
    description: "The captain's avatar at 100px, or null when they have none.",
    nullable: true,
  })
  profilePicture100: string | null;

  @ApiProperty({
    description: "The captain's faction name, or null when not recorded.",
    nullable: true,
    example: 'TOS Starfleet',
  })
  factionName: string | null;

  @ApiProperty({
    description: "The captain's faction icon, or null when there is none.",
    nullable: true,
  })
  factionIconUrl: string | null;

  @ApiProperty({
    description:
      "The captain's general faction name, which drives the row colour.",
    nullable: true,
    example: 'Federation',
  })
  generalFactionName: string | null;

  @ApiProperty({
    description:
      'When the owner pinned this captain, or null when not pinned. Pinned captains lead their account.',
    nullable: true,
  })
  pinnedAt: Date | null;
}

/**
 * One account, with its captains, as the quick-switch list needs it.
 */
export class AccountSwitcherAccountDto {
  @ApiProperty({ description: 'The account ID.' })
  id: string;

  @ApiProperty({
    description: 'The account handle, which also addresses it in the URL.',
    example: 'Steve#1234',
  })
  handle: string;

  @ApiProperty({
    description:
      "The platform name, which drives the row's colour. Null when not recorded.",
    nullable: true,
    example: 'Windows',
  })
  platformName: string | null;

  @ApiProperty({
    description:
      "The launcher name, which refines a PC account's colour. Null when not recorded.",
    nullable: true,
    example: 'Steam',
  })
  launcherName: string | null;

  @ApiProperty({
    description: 'Whether the account holds a lifetime subscription.',
  })
  lifetimeSubscription: boolean;

  @ApiProperty({
    description:
      'When the owner pinned this account, or null when not pinned. Pinned accounts lead the list.',
    nullable: true,
  })
  pinnedAt: Date | null;

  @ApiProperty({
    description:
      "The account's captains, pinned first and then by handle. Empty for an account with no captains yet, which is still listed so it can be switched to.",
    type: [AccountSwitcherCharacterDto],
  })
  characters: AccountSwitcherCharacterDto[];
}
