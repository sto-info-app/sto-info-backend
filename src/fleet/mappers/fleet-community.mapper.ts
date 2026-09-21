import { Injectable } from '@nestjs/common';

import { FleetCommunityDto } from '../dto/fleet-community.dto';
import { FleetCommunityEntity } from '../entities/fleet-community.entity';

/**
 * Turns a Fleet Community into the shape the API returns.
 *
 * Fields are listed rather than spread, so a column added to the entity later
 * stays private until somebody decides otherwise. `ownerUserId` is the only
 * thing here that identifies a person, and it is already how the client knows
 * whether to offer the owner's controls.
 */
@Injectable()
export class FleetCommunityMapper {
  /**
   * Maps a Community to its API shape.
   *
   * @param community - The Community entity.
   * @returns The Community as a caller sees it.
   */
  toDto(community: FleetCommunityEntity): FleetCommunityDto {
    return {
      id: community.id,
      ownerUserId: community.ownerUserId,
      name: community.name,
      slug: community.slug,
      description: community.description,
      recruitmentState: community.recruitmentState,
      visibility: community.visibility,
      preferredTimezone: community.preferredTimezone,
      status: community.status,
      closedAt: community.closedAt,
      revision: community.revision,
      createdAt: community.createdAt,
      updatedAt: community.updatedAt,
    };
  }
}
