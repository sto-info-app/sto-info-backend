import { Injectable } from '@nestjs/common';

import { ArmadaDuplicateDto, StoArmadaDto } from '../dto/sto-armada.dto';
import { StoArmadaEntity } from '../entities/sto-armada.entity';
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
}
