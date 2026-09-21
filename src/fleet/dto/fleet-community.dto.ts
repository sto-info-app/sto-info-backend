import { ApiProperty } from '@nestjs/swagger';

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * A Fleet Community as a caller sees it.
 *
 * The same shape whoever is asking, because nothing here is private: a
 * Community's name, slug and recruitment posture are what a directory card
 * shows. What is behind it — rosters, members, applications — is read through
 * its own routes, each with its own capability.
 */
export class FleetCommunityDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'The user who owns this Community.' })
  ownerUserId: string;

  @ApiProperty({ description: 'Display name, as the owner wrote it.' })
  name: string;

  @ApiProperty({ description: 'Lowercase URL segment.' })
  slug: string;

  @ApiProperty({ description: 'What the Community is.', nullable: true })
  description: string | null;

  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Community accepts new subscribers.',
  })
  recruitmentState: FleetRecruitmentState;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see the Community record.',
  })
  visibility: FleetAudience;

  @ApiProperty({ description: 'Default IANA display timezone.' })
  preferredTimezone: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;

  @ApiProperty({
    description: 'When the Community was closed.',
    nullable: true,
  })
  closedAt: Date | null;

  /**
   * The authorisation revision, as a hint that a cached view is stale.
   *
   * Never an access decision. Plan section 4.2: the service check stays
   * authoritative even when invalidation is late.
   */
  @ApiProperty({ description: 'Authorisation revision counter.' })
  revision: number;

  @ApiProperty({ description: 'When the Community was registered.' })
  createdAt: Date;

  @ApiProperty({ description: 'When it was last changed.' })
  updatedAt: Date;
}

/**
 * A Community reached by URL segment, and whether that segment is still its.
 *
 * Answered as a body rather than as a `301`, because the caller is a
 * single-page application resolving a route it is about to render: it has to
 * replace the address in the history stack, which a transparent HTTP redirect
 * would have already followed without telling it. The status code stays `200`
 * and the client decides — ADR-0022.
 */
export class ResolvedFleetCommunityDto {
  @ApiProperty({ type: FleetCommunityDto })
  community: FleetCommunityDto;

  @ApiProperty({
    description:
      'The retired segment the caller asked for, when it was not the ' +
      'current one. Non-null means the address shown should be replaced ' +
      'with the Community’s current slug.',
    nullable: true,
  })
  redirectedFrom: string | null;
}
