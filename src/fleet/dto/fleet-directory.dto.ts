import { ApiProperty } from '@nestjs/swagger';

import { FleetRecruitmentState } from '../enums/fleet-recruitment-state.enum';
import { FleetScopeStatus } from '../enums/fleet-scope-status.enum';

/**
 * What every directory card says, whatever scope it describes.
 *
 * The four fields below are the ones a reader compares. `duplicateCount` is
 * the reason this listing is called duplicate-aware rather than merely
 * ordered: a card that sits beside three others answering to the same name
 * says so on its face, so somebody about to register a fourth is told before
 * they start rather than after they finish.
 */
export class FleetDirectoryCardDto {
  @ApiProperty({ description: 'Unique identifier.' })
  id: string;

  @ApiProperty({ description: 'Lowercase URL segment.' })
  slug: string;

  @ApiProperty({ enum: FleetScopeStatus, description: 'Lifecycle state.' })
  status: FleetScopeStatus;

  @ApiProperty({ description: 'When the record was registered.' })
  createdAt: Date;
}

/**
 * One Fleet Community in the directory.
 *
 * No duplicate count. A Community's name is its own — it names a group of
 * people rather than claiming an in-game entity — so two Communities sharing
 * one are not two records of the same thing, and there is no folded name
 * column to group them by. The Fleet and Armada cards carry a count because
 * those records do claim to describe something that exists in game exactly
 * once.
 */
export class FleetCommunityCardDto extends FleetDirectoryCardDto {
  @ApiProperty({ description: 'Display name, as the owner wrote it.' })
  name: string;

  @ApiProperty({ description: 'What the Community is.', nullable: true })
  description: string | null;

  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'Whether and how it accepts new subscribers.',
  })
  recruitmentState: FleetRecruitmentState;
}

/**
 * A card describing a record of something that exists in game.
 *
 * Both a Fleet and an Armada are one Community's record of a thing the game
 * holds once, which is what makes a second record for the same name worth
 * pointing at. The three fields here are what tell two such records apart:
 * whose it is, which platform it is on, and — for a Fleet — how current it is.
 */
export class InGameScopeCardDto extends FleetDirectoryCardDto {
  @ApiProperty({
    description:
      'The name exactly as it appears in game. Any leading or trailing ' +
      'space is part of the name and must stay visible wherever the name is ' +
      'shown: it may be the only thing telling two records apart.',
  })
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
      'The platform as a URL segment, derived from its name rather than ' +
      'stored, so the two can never disagree.',
  })
  platformSegment: string;

  @ApiProperty({
    description:
      'How many *other* listed records answer to the same name on the same ' +
      'platform. Zero for all but a handful. It counts what this caller ' +
      'could actually reach and compare — the same audience and the same ' +
      'lifecycle filter as the list itself — so the number never promises a ' +
      'record the reader cannot open.',
  })
  duplicateCount: number;
}

/**
 * One Fleet in the directory.
 */
export class StoFleetCardDto extends InGameScopeCardDto {
  @ApiProperty({
    enum: FleetRecruitmentState,
    description: 'Whether and how the Fleet accepts applications.',
  })
  recruitmentState: FleetRecruitmentState;

  @ApiProperty({ description: 'Allegiance, if known.', nullable: true })
  allegianceFactionId: string | null;

  @ApiProperty({
    description:
      'Export instant of its newest effective roster import, which is how ' +
      'fresh the record is. Null means nothing has ever been imported for ' +
      'it, which is itself the most useful thing to know about it.',
    nullable: true,
  })
  lastEffectiveImportAt: Date | null;
}

/**
 * One Armada in the directory.
 *
 * Always has a Community — the schema requires one — so the inherited
 * nullable Community fields are never null here. They stay nullable rather
 * than being redeclared, because the shape a client writes against is shared
 * with the Fleet card and a type that differed only in nullability would make
 * one component into two.
 */
export class StoArmadaCardDto extends InGameScopeCardDto {
  @ApiProperty({
    description: 'What the Community prefers to call it.',
    nullable: true,
  })
  displayName: string | null;
}

/**
 * A page of directory cards.
 *
 * Offset paging rather than a cursor, matching every other listing in the
 * application. A directory is read by somebody scanning and jumping, and the
 * total is part of the answer — "17 Fleets answer to this" is most of what a
 * search for a duplicate is asking.
 */
export class FleetCommunityDirectoryPageDto {
  @ApiProperty({ type: [FleetCommunityCardDto] })
  items: FleetCommunityCardDto[];

  @ApiProperty({ description: 'Total matching records.', example: 128 })
  total: number;

  @ApiProperty({ description: 'The page returned.', example: 1 })
  page: number;

  @ApiProperty({ description: 'Records per page.', example: 20 })
  pageSize: number;
}

/**
 * A page of Fleet directory cards.
 */
export class StoFleetDirectoryPageDto {
  @ApiProperty({ type: [StoFleetCardDto] })
  items: StoFleetCardDto[];

  @ApiProperty({ description: 'Total matching records.', example: 128 })
  total: number;

  @ApiProperty({ description: 'The page returned.', example: 1 })
  page: number;

  @ApiProperty({ description: 'Records per page.', example: 20 })
  pageSize: number;
}

/**
 * A page of Armada directory cards.
 */
export class StoArmadaDirectoryPageDto {
  @ApiProperty({ type: [StoArmadaCardDto] })
  items: StoArmadaCardDto[];

  @ApiProperty({ description: 'Total matching records.', example: 128 })
  total: number;

  @ApiProperty({ description: 'The page returned.', example: 1 })
  page: number;

  @ApiProperty({ description: 'Records per page.', example: 20 })
  pageSize: number;
}
