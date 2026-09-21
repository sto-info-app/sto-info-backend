import { ApiProperty } from '@nestjs/swagger';

import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * An Armada as a caller sees it.
 *
 * No audience field, because `sto_armada` has no such column: an Armada is
 * seen exactly as far as the Community holding it is. Nothing here says which
 * Fleets are in it either — that is a temporal record with its own route,
 * so a Fleet can leave without this shape changing at all.
 */
export class StoArmadaDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'Owning Community.' })
  communityId: string;

  @ApiProperty({ description: 'The platform the Armada exists on.' })
  platformId: string;

  @ApiProperty({ description: 'The platform, as the catalogue names it.' })
  platformName: string;

  @ApiProperty({
    description:
      'The platform as a URL segment, derived from its name rather than ' +
      'stored, so the two can never disagree.',
  })
  platformSegment: string;

  @ApiProperty({
    description:
      'The Armada name exactly as it appears in game. Any leading or ' +
      'trailing space is part of the name and must stay visible wherever ' +
      'the name is shown.',
  })
  exactGameName: string;

  @ApiProperty({
    description: 'What the Community prefers to call it.',
    nullable: true,
  })
  displayName: string | null;

  @ApiProperty({
    description: 'Lowercase URL segment, unique per Community and platform.',
  })
  slug: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;

  @ApiProperty({ description: 'When the Armada was closed.', nullable: true })
  closedAt: Date | null;

  @ApiProperty({ description: 'Authorisation revision counter.' })
  revision: number;

  @ApiProperty({ description: 'When the Armada was registered.' })
  createdAt: Date;

  @ApiProperty({ description: 'When it was last changed.' })
  updatedAt: Date;
}

/**
 * A record that already answers to the name somebody is registering.
 *
 * Advisory, exactly as the Fleet one is. Two Communities may each keep a
 * record of the same in-game Armada — more readily than for a Fleet, in
 * fact, since every member Fleet's Community has reason to record the
 * Armada it belongs to — so this is shown and never enforced.
 */
export class ArmadaDuplicateDto {
  @ApiProperty({ description: 'The existing record.' })
  id: string;

  @ApiProperty({ description: 'Its name, exactly as recorded.' })
  exactGameName: string;

  @ApiProperty({ description: 'The Community holding it.' })
  communityId: string;

  @ApiProperty({ description: 'That Community’s name.' })
  communityName: string;

  @ApiProperty({ description: 'That Community’s URL segment.' })
  communitySlug: string;

  @ApiProperty({ description: 'The platform it is recorded on.' })
  platformId: string;

  @ApiProperty({ description: 'The platform, as the catalogue names it.' })
  platformName: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;
}

/** A newly registered Armada, with anything that already looked like it. */
export class RegisteredStoArmadaDto {
  @ApiProperty({ type: StoArmadaDto })
  armada: StoArmadaDto;

  @ApiProperty({
    type: [ArmadaDuplicateDto],
    description: 'Records that already answer to this name on this platform.',
  })
  duplicates: ArmadaDuplicateDto[];
}

/**
 * An Armada reached by its canonical URL.
 *
 * The same shape as the Fleet answer, and for the same reasons: three
 * segments answered separately so an Angular resolver can rebuild its own
 * route, and `redirected` rather than a `301` so it can replace its own
 * history entry — ADR-0022.
 */
export class ResolvedStoArmadaDto {
  @ApiProperty({ type: StoArmadaDto })
  armada: StoArmadaDto;

  @ApiProperty({ description: 'The owning Community’s current URL segment.' })
  communitySlug: string;

  @ApiProperty({ description: 'The platform’s current URL segment.' })
  platformSegment: string;

  @ApiProperty({
    description:
      'True when the address asked for is no longer the canonical one, so ' +
      'the caller should replace it with the segments above.',
  })
  redirected: boolean;
}
