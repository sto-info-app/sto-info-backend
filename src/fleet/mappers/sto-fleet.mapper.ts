import { Injectable } from '@nestjs/common';

import { StoFleetCardDto } from '../dto/fleet-directory.dto';
import { FleetDuplicateDto, StoFleetDto } from '../dto/sto-fleet.dto';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { DirectoryEntry } from '../services/fleet-directory-page.interface';
import { toPlatformSegment } from '../utilities/platform-segment.utility';

/**
 * Turns a Fleet into the shapes the API returns.
 *
 * Fields are listed rather than spread, so a column added to the entity later
 * stays private until somebody decides otherwise.
 *
 * Both methods require the `platform` relation to have been loaded, and the
 * duplicate one requires `community` as well. That is a demand on the caller
 * rather than a fallback here on purpose: a mapper that quietly emitted an
 * empty platform would turn a forgotten relation into a directory card
 * claiming a Fleet exists on no platform at all, which reads like data rather
 * than like the bug it is.
 */
@Injectable()
export class StoFleetMapper {
  /**
   * Maps a Fleet to its API shape.
   *
   * @param fleet - The Fleet entity, with its platform loaded.
   * @returns The Fleet as a caller sees it.
   */
  toDto(fleet: StoFleetEntity): StoFleetDto {
    return {
      id: fleet.id,
      communityId: fleet.communityId,
      platformId: fleet.platformId,
      platformName: fleet.platform.name,
      platformSegment: toPlatformSegment(fleet.platform.name),
      exactGameName: fleet.exactGameName,
      allegianceFactionId: fleet.allegianceFactionId,
      slug: fleet.slug,
      recruitmentState: fleet.recruitmentState,
      visibility: fleet.visibility,
      lastEffectiveImportAt: fleet.lastEffectiveImportAt,
      status: fleet.status,
      closedAt: fleet.closedAt,
      bannerImageId: fleet.bannerImageId,
      bannerImageAlt: fleet.bannerImageAlt,
      emblemImageId: fleet.emblemImageId,
      emblemImageAlt: fleet.emblemImageAlt,
      revision: fleet.revision,
      createdAt: fleet.createdAt,
      updatedAt: fleet.updatedAt,
    };
  }

  /**
   * Maps a Fleet to the summary shown as a possible duplicate.
   *
   * Narrower than {@link toDto} because it describes somebody else's record.
   * It says who holds it and how current it is — which is what tells two
   * records for the same in-game Fleet apart — and nothing about its
   * recruitment, its audience or its allegiance, none of which is any of the
   * registrant's business.
   *
   * @param fleet - The Fleet entity, with its platform and Community loaded.
   * @returns The duplicate summary.
   */
  toDuplicateDto(fleet: StoFleetEntity): FleetDuplicateDto {
    return {
      id: fleet.id,
      exactGameName: fleet.exactGameName,
      communityId: fleet.communityId,
      communityName: fleet.community?.name ?? null,
      communitySlug: fleet.community?.slug ?? null,
      platformId: fleet.platformId,
      platformName: fleet.platform.name,
      lastEffectiveImportAt: fleet.lastEffectiveImportAt,
      status: fleet.status,
    };
  }

  /**
   * Maps a Fleet to the card the directory lists it as.
   *
   * Narrower than {@link toDto} and wider than {@link toDuplicateDto}. A
   * directory card is read by somebody choosing between records rather than
   * by somebody about to be warned off one, so it keeps the recruitment
   * posture and the allegiance — which is what makes a Fleet worth clicking
   * — while still saying nothing about an audience the reader is inside of,
   * because everything listed here is public by definition.
   *
   * @param entry - The Fleet, with its platform and Community loaded, and
   *   how many other listed records answer to its name.
   * @returns The directory card.
   */
  toCardDto(entry: DirectoryEntry<StoFleetEntity>): StoFleetCardDto {
    const fleet = entry.record;

    return {
      id: fleet.id,
      slug: fleet.slug,
      status: fleet.status,
      createdAt: fleet.createdAt,
      emblemImageId: fleet.emblemImageId,
      emblemImageAlt: fleet.emblemImageAlt,
      exactGameName: fleet.exactGameName,
      communityId: fleet.communityId,
      communityName: fleet.community?.name ?? null,
      communitySlug: fleet.community?.slug ?? null,
      platformId: fleet.platformId,
      platformName: fleet.platform.name,
      platformSegment: toPlatformSegment(fleet.platform.name),
      duplicateCount: entry.duplicateCount,
      recruitmentState: fleet.recruitmentState,
      allegianceFactionId: fleet.allegianceFactionId,
      lastEffectiveImportAt: fleet.lastEffectiveImportAt,
    };
  }
}
