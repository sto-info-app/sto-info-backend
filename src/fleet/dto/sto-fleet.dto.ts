import { ApiProperty } from '@nestjs/swagger';

import { FleetAudience } from '../enums/fleet-audience.enum';
import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * A Fleet as a caller sees it.
 *
 * Carries the platform's name and URL segment as well as its identifier,
 * because every surface that shows a Fleet shows the platform beside it: two
 * records with the same name on PC and on Xbox are different Fleets, and a
 * card that omitted the platform would be telling the reader they are the
 * same one.
 */
export class StoFleetDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({
    description: 'Owning Community, or null for an unregistered record.',
    nullable: true,
  })
  communityId: string | null;

  @ApiProperty({ description: 'The platform the Fleet exists on.' })
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
      'The Fleet name exactly as it appears in game. Any leading or ' +
      'trailing space is part of the name and must stay visible wherever ' +
      'the name is shown: it may be the only thing telling two Fleets apart.',
  })
  exactGameName: string;

  @ApiProperty({ description: 'Allegiance, if known.', nullable: true })
  allegianceFactionId: string | null;

  @ApiProperty({
    description: 'Lowercase URL segment, unique per Community and platform.',
  })
  slug: string;

  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Fleet accepts applications.',
  })
  recruitmentState: FleetRecruitmentState;

  @ApiProperty({
    enum: FleetAudience,
    description: 'Who may see the Fleet record.',
  })
  visibility: FleetAudience;

  @ApiProperty({
    description: 'Export instant of the newest effective roster import.',
    nullable: true,
  })
  lastEffectiveImportAt: Date | null;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;

  @ApiProperty({ description: 'When the Fleet was closed.', nullable: true })
  closedAt: Date | null;

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
    description: 'Delivery reference of the square emblem.',
    nullable: true,
  })
  emblemImageId: string | null;

  @ApiProperty({
    description: 'What the emblem shows, for readers who cannot see it.',
    nullable: true,
  })
  emblemImageAlt: string | null;

  @ApiProperty({ description: 'Authorisation revision counter.' })
  revision: number;

  @ApiProperty({ description: 'When the Fleet was registered.' })
  createdAt: Date;

  @ApiProperty({ description: 'When it was last changed.' })
  updatedAt: Date;
}

/**
 * A record that already answers to the name somebody is registering.
 *
 * Deliberately not a reason to refuse them. Two Communities may each hold a
 * record for the same in-game Fleet and neither is authoritative — plan
 * section 4.1 — so this is shown, never enforced. What it carries is what
 * FC-013's third acceptance criterion asks for: enough to tell the records
 * apart by **whose** they are and **how current** they are.
 */
export class FleetDuplicateDto {
  @ApiProperty({ description: 'The existing record.' })
  id: string;

  @ApiProperty({ description: 'Its name, exactly as recorded.' })
  exactGameName: string;

  @ApiProperty({
    description: 'The Community holding it, or null when unregistered.',
    nullable: true,
  })
  communityId: string | null;

  @ApiProperty({
    description: 'That Community’s name, or null when unregistered.',
    nullable: true,
  })
  communityName: string | null;

  @ApiProperty({
    description: 'That Community’s URL segment, or null when unregistered.',
    nullable: true,
  })
  communitySlug: string | null;

  @ApiProperty({ description: 'The platform it is recorded on.' })
  platformId: string;

  @ApiProperty({ description: 'The platform, as the catalogue names it.' })
  platformName: string;

  @ApiProperty({
    description:
      'Export instant of its newest effective roster import, which is how ' +
      'fresh the record is. Null means nothing has ever been imported for ' +
      'it, which is itself the most useful thing to know about it.',
    nullable: true,
  })
  lastEffectiveImportAt: Date | null;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;
}

/**
 * A newly registered Fleet, with anything that already looked like it.
 *
 * The matches are returned rather than used to refuse the registration, and
 * they are returned *after* it has succeeded rather than instead of it. A
 * registrant who has just been told what already exists can close their own
 * record; a registrant refused outright has nothing to compare and no way
 * through.
 */
export class RegisteredStoFleetDto {
  @ApiProperty({ type: StoFleetDto })
  fleet: StoFleetDto;

  @ApiProperty({
    type: [FleetDuplicateDto],
    description: 'Records that already answer to this name on this platform.',
  })
  duplicates: FleetDuplicateDto[];
}

/**
 * A Fleet reached by its canonical URL.
 *
 * The three segments of that URL are answered separately rather than as a
 * path, because the client is an Angular resolver assembling its own routes
 * and a string it has to take apart again helps nobody. `redirected` is true
 * when any segment the caller used is no longer the current one, which is the
 * single fact the resolver needs in order to replace its history entry —
 * ADR-0022, and the reason this is a `200` rather than a `301`.
 */
export class ResolvedStoFleetDto {
  @ApiProperty({ type: StoFleetDto })
  fleet: StoFleetDto;

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
