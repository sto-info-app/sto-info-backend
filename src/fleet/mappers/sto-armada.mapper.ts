import { Injectable } from '@nestjs/common';

import { StoArmadaCardDto } from '../dto/fleet-directory.dto';
import { ArmadaDuplicateDto, StoArmadaDto } from '../dto/sto-armada.dto';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
import { DirectoryEntry } from '../services/fleet-directory-page.interface';
import { toPlatformSegment } from '../utilities/platform-segment.utility';

/**
 * Turns an Armada into the shapes the API returns.
 *
 * Fields are listed rather than spread, so a column added to the entity later
 * stays private until somebody decides otherwise.
 *
 * Both methods require the `platform` relation to have been loaded, and the
 * duplicate one requires `community` as well — a demand on the caller rather
 * than a fallback here, because a card claiming an Armada exists on no
 * platform at all reads like data rather than like the bug it is.
 */
@Injectable()
export class StoArmadaMapper {
  /**
   * Maps an Armada to its API shape.
   *
   * @param armada - The Armada entity, with its platform loaded.
   * @returns The Armada as a caller sees it.
   */
  toDto(armada: StoArmadaEntity): StoArmadaDto {
    return {
      id: armada.id,
      communityId: armada.communityId,
      platformId: armada.platformId,
      platformName: armada.platform.name,
      platformSegment: toPlatformSegment(armada.platform.name),
      exactGameName: armada.exactGameName,
      displayName: armada.displayName,
      slug: armada.slug,
      status: armada.status,
      closedAt: armada.closedAt,
      bannerImageId: armada.bannerImageId,
      bannerImageAlt: armada.bannerImageAlt,
      emblemImageId: armada.emblemImageId,
      emblemImageAlt: armada.emblemImageAlt,
      revision: armada.revision,
      createdAt: armada.createdAt,
      updatedAt: armada.updatedAt,
    };
  }

  /**
   * Maps an Armada to the summary shown as a possible duplicate.
   *
   * Says whose the record is and nothing else about it. An Armada has no
   * roster and no import, so unlike a Fleet there is no freshness to report:
   * which Community holds it is the whole of what tells two records apart.
   *
   * @param armada - The Armada entity, with its platform and Community.
   * @returns The duplicate summary.
   */
  toDuplicateDto(armada: StoArmadaEntity): ArmadaDuplicateDto {
    return {
      id: armada.id,
      exactGameName: armada.exactGameName,
      communityId: armada.communityId,
      communityName: armada.community.name,
      communitySlug: armada.community.slug,
      platformId: armada.platformId,
      platformName: armada.platform.name,
      status: armada.status,
    };
  }

  /**
   * Maps an Armada to the card the directory lists it as.
   *
   * The Community fields are never null here — the schema requires one — but
   * they are typed as nullable because the card shape is shared with the
   * Fleet, which may have none. Answering the shared shape honestly costs
   * nothing and saves the client writing two components.
   *
   * @param entry - The Armada, with its platform and Community loaded, and
   *   how many other listed records answer to its name.
   * @returns The directory card.
   */
  toCardDto(entry: DirectoryEntry<StoArmadaEntity>): StoArmadaCardDto {
    const armada = entry.record;

    return {
      id: armada.id,
      slug: armada.slug,
      status: armada.status,
      createdAt: armada.createdAt,
      emblemImageId: armada.emblemImageId,
      emblemImageAlt: armada.emblemImageAlt,
      exactGameName: armada.exactGameName,
      communityId: armada.communityId,
      communityName: armada.community.name,
      communitySlug: armada.community.slug,
      platformId: armada.platformId,
      platformName: armada.platform.name,
      platformSegment: toPlatformSegment(armada.platform.name),
      duplicateCount: entry.duplicateCount,
      displayName: armada.displayName,
    };
  }
}
