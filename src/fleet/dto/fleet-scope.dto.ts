import { ApiProperty } from '@nestjs/swagger';

import { EmblemImageUrls } from 'src/shared/constants/image.constants';

import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * What a caller sees of any Fleet scope, whatever its kind: its identifier,
 * lifecycle state, banner and emblem, authorisation revision and when it last
 * changed.
 *
 * Abstract: a Community, a Fleet and an Armada each extend it with their own
 * fields, and with the wording of the dates that name the kind.
 */
export abstract class FleetScopeDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;

  @ApiProperty({
    description: 'Delivery reference of the wide banner.',
    nullable: true,
  })
  bannerImageId: string | null;

  @ApiProperty({
    description: 'What the banner shows, for readers who cannot see it.',
    nullable: true,
  })
  bannerImageAlt: string | null;

  @ApiProperty({
    description: 'The banner’s signed address, for the browser (FC-040).',
    nullable: true,
    type: String,
  })
  bannerImageUrl: string | null;

  @ApiProperty({
    description: 'Delivery reference of the square emblem.',
    nullable: true,
  })
  emblemImageId: string | null;

  @ApiProperty({
    description: 'What the emblem shows, for readers who cannot see it.',
    nullable: true,
  })
  emblemImageAlt: string | null;

  @ApiProperty({
    description:
      'The emblem’s signed addresses, by variant (square100, square300), ' +
      'for the browser to draw (FC-040).',
    nullable: true,
    type: Object,
  })
  emblemImageUrls: EmblemImageUrls | null;

  /**
   * The authorisation revision, as a hint that a cached view is stale.
   *
   * Never an access decision. Plan section 4.2: the service check stays
   * authoritative even when invalidation is late.
   */
  @ApiProperty({ description: 'Authorisation revision counter.' })
  revision: number;

  @ApiProperty({ description: 'When it was last changed.' })
  updatedAt: Date;
}
