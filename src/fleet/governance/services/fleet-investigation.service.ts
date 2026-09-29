import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource, In, MoreThan } from 'typeorm';

import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { usernamesFor } from '../../recruitment/utilities/recruitment-names.utility';
import { toPlatformSegment } from '../../utilities/platform-segment.utility';
import {
  FleetInvestigationDto,
  FleetInvestigationPageDto,
} from '../dto/fleet-investigation.dto';
import { FleetInvestigationGrantEntity } from '../entities/fleet-investigation-grant.entity';

/** How long a site admin may look into a Fleet, in milliseconds. */
export const FLEET_INVESTIGATION_MS = 24 * 3_600_000;

/** A page of the log, unless asked otherwise. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * A site admin's look into one Fleet's roster imports (FC-036).
 *
 * Steve's decision of 29 September 2026: a site admin gives a purpose, and
 * may then read the Fleet's Investigate pages — its imports, rows, conflicts,
 * identity decisions and rank order — for 24 hours, and change nothing. The
 * grant row is the record of who looked, where, why and until when; the
 * resolver reads it and confers `roster.investigate.read`. There is still no
 * way to see a raw roster file.
 */
@Injectable()
export class FleetInvestigationService {
  private readonly _logger = new Logger(FleetInvestigationService.name);

  /**
   * Creates an instance of FleetInvestigationService.
   *
   * @param _dataSource - The database.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Opens a look into a Fleet, for 24 hours.
   *
   * @param communityId - The Community holding it.
   * @param fleetId - The Fleet.
   * @param adminUserId - The site admin.
   * @param purpose - Why.
   * @returns The grant.
   * @throws NotFoundException when the Community holds no such Fleet.
   */
  async open(
    communityId: string,
    fleetId: string,
    adminUserId: string,
    purpose: string,
  ): Promise<FleetInvestigationDto> {
    const manager = this._dataSource.manager;
    const fleet = await manager.findOne(StoFleetEntity, {
      where: { id: fleetId, communityId },
    });

    if (fleet === null) {
      throw new NotFoundException('Not found');
    }

    const now = new Date();
    const grant = await manager.save(FleetInvestigationGrantEntity, {
      communityId,
      fleetId,
      adminUserId,
      purpose,
      createdAt: now,
      expiresAt: new Date(now.getTime() + FLEET_INVESTIGATION_MS),
    });

    this._logger.log(
      `[open] Fleet investigation opened - FleetId: ${fleetId}, ` +
        `GrantId: ${grant.id}`,
    );

    return (await this.toDtos([grant]))[0];
  }

  /**
   * The looks a site admin has open now.
   *
   * @param adminUserId - The site admin.
   * @returns Each, soonest to end first.
   */
  async mine(adminUserId: string): Promise<FleetInvestigationDto[]> {
    const grants = await this._dataSource.manager.find(
      FleetInvestigationGrantEntity,
      {
        where: { adminUserId, expiresAt: MoreThan(new Date()) },
        order: { expiresAt: 'ASC' },
      },
    );

    return this.toDtos(grants);
  }

  /**
   * Every look any site admin has taken, newest first.
   *
   * @param page - Which page.
   * @param pageSize - How many a page.
   * @returns The page.
   */
  async log(
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<FleetInvestigationPageDto> {
    const [grants, total] = await this._dataSource.manager.findAndCount(
      FleetInvestigationGrantEntity,
      {
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      },
    );

    return { items: await this.toDtos(grants), total, page, pageSize };
  }

  /**
   * Shows grants, with who, and where.
   *
   * @param grants - The grants.
   * @returns Each.
   */
  private async toDtos(
    grants: readonly FleetInvestigationGrantEntity[],
  ): Promise<FleetInvestigationDto[]> {
    if (grants.length === 0) {
      return [];
    }

    const manager = this._dataSource.manager;
    // A grant goes with its Fleet, so each still has one.
    const fleets = await manager.find(StoFleetEntity, {
      where: { id: In(grants.map(grant => grant.fleetId)) },
      relations: { platform: true },
      withDeleted: true,
    });
    const communities = await manager.find(FleetCommunityEntity, {
      where: { id: In(grants.map(grant => grant.communityId)) },
      withDeleted: true,
    });
    const fleetById = new Map(fleets.map(fleet => [fleet.id, fleet]));
    const communityById = new Map(communities.map(each => [each.id, each]));
    const names = await usernamesFor(
      manager,
      grants.map(grant => grant.adminUserId),
    );
    const now = Date.now();

    return grants.map(grant => {
      const fleet = fleetById.get(grant.fleetId) as StoFleetEntity;
      const community = communityById.get(grant.communityId);

      return {
        id: grant.id,
        communityId: grant.communityId,
        communityName: community?.name ?? null,
        communitySlug: community?.slug ?? null,
        fleetId: grant.fleetId,
        fleetName: fleet.exactGameName,
        fleetSlug: fleet.slug,
        platformName: fleet.platform.name,
        platformSegment: toPlatformSegment(fleet.platform.name),
        admin:
          grant.adminUserId === null
            ? null
            : {
                userId: grant.adminUserId,
                username: names.get(grant.adminUserId) ?? null,
              },
        purpose: grant.purpose,
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
        active: grant.expiresAt.getTime() > now,
      };
    });
  }
}
