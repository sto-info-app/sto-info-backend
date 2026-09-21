import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { findPlatformBySegment } from '../utilities/platform-segment.utility';

/**
 * Reads the platform catalogue on behalf of the Fleet feature.
 *
 * Exists so that the two ways a request can name a platform are answered in
 * one place. A write names it by identifier, because the client picked it
 * from the catalogue it already loaded; a URL names it by segment, because
 * `.../fleets/windows/omega` is an address a person can read and type.
 *
 * The segment is derived from the catalogue name rather than stored beside
 * it — ADR-0022 decision 3 — so the two can never disagree, at the accepted
 * cost that renaming a platform changes every URL beneath it. There is no
 * fallback for a segment naming no platform: serving a Fleet from the wrong
 * platform under a plausible address is worse than serving none.
 */
@Injectable()
export class FleetPlatformService {
  /**
   * Creates an instance of FleetPlatformService.
   *
   * @param _platformRepository - Repository of platforms.
   */
  constructor(
    @InjectRepository(PlatformEntity)
    private readonly _platformRepository: Repository<PlatformEntity>,
  ) {}

  /**
   * Reads the platform a request body named.
   *
   * @param platformId - The identifier from the request.
   * @returns The platform.
   * @throws BadRequestException when no such platform exists. A platform is
   *   reference data the client chose from a list it was given, so naming one
   *   that is not there is a malformed request rather than a missing page.
   */
  async findByIdOrFail(platformId: string): Promise<PlatformEntity> {
    const platform = await this._platformRepository.findOne({
      where: { id: platformId },
    });

    if (!platform) {
      throw new BadRequestException('That is not a platform this site knows.');
    }

    return platform;
  }

  /**
   * Reads the platform a URL segment names.
   *
   * Matching is case-insensitive inbound, so a capitalised link somebody
   * saved years ago still resolves, while every address the site writes is
   * lowercase.
   *
   * @param segment - The segment from the URL.
   * @returns The platform.
   * @throws NotFoundException when the segment names no platform. The
   *   address is wrong rather than the request, and nothing about it can be
   *   corrected by sending it again.
   */
  async findBySegmentOrFail(segment: string): Promise<PlatformEntity> {
    const platforms = await this._platformRepository.find();
    const platform = findPlatformBySegment(segment, platforms);

    if (!platform) {
      throw new NotFoundException('Not found');
    }

    return platform;
  }
}
