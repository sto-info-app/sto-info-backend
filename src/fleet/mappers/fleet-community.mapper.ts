import { Injectable } from '@nestjs/common';

import { FleetCommunityDto } from '../dto/fleet-community.dto';
import { FleetCommunityCardDto } from '../dto/fleet-directory.dto';
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
      bannerImageId: community.bannerImageId,
      bannerImageAlt: community.bannerImageAlt,
      emblemImageId: community.emblemImageId,
      emblemImageAlt: community.emblemImageAlt,
      revision: community.revision,
      createdAt: community.createdAt,
      updatedAt: community.updatedAt,
    };
  }

  /**
   * Maps a Community to the card the directory lists it as.
   *
   * Leaves out the owner. Everything else on {@link toDto} is either shown
   * on the card or is machinery — a revision counter, a timezone, a closure
   * instant — but the owner's identifier is a person, and a directory page
   * is a list long enough that publishing one identifier per row turns a
   * browse into a harvest. Somebody opening the Community itself is told.
   *
   * @param community - The Community entity.
   * @returns The directory card.
   */
  toCardDto(community: FleetCommunityEntity): FleetCommunityCardDto {
    return {
      id: community.id,
      slug: community.slug,
      status: community.status,
      createdAt: community.createdAt,
      emblemImageId: community.emblemImageId,
      emblemImageAlt: community.emblemImageAlt,
      name: community.name,
      description: community.description,
      recruitmentState: community.recruitmentState,
    };
  }
}
