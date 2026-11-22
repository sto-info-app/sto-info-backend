import { NotFoundException } from '@nestjs/common';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager, Row } from '../../../../test/in-memory-manager';
import { FleetCommunityEntity } from '../../entities/fleet-community.entity';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetInvestigationGrantEntity } from '../entities/fleet-investigation-grant.entity';
import {
  FLEET_INVESTIGATION_MS,
  FleetInvestigationService,
} from './fleet-investigation.service';

const HOUR = 3_600_000;

describe('FleetInvestigationService', () => {
  let db: InMemoryManager;
  let service: FleetInvestigationService;

  beforeEach(() => {
    db = new InMemoryManager()
      .seed(FleetCommunityEntity, [
        { id: 'community-1', name: 'Fixture Community', slug: 'fixture' },
      ])
      .seed(StoFleetEntity, [
        {
          id: 'fleet-1',
          communityId: 'community-1',
          exactGameName: 'Fixture Fleet',
          slug: 'fixture-fleet',
          platform: { name: 'PlayStation 5' },
        },
      ])
      .seed(UserProfileEntity, [{ userId: 'admin-1', username: 'Quark' }]);
    service = new FleetInvestigationService(db.asDataSource());
  });

  /**
   * Seeds a grant.
   *
   * @param overrides - What differs.
   */
  const seedGrant = (overrides: Record<string, unknown>) =>
    db.seed(FleetInvestigationGrantEntity, [
      {
        communityId: 'community-1',
        fleetId: 'fleet-1',
        adminUserId: 'admin-1',
        purpose: 'Looking into a complaint',
        createdAt: new Date(Date.now() - HOUR),
        expiresAt: new Date(Date.now() + HOUR),
        ...overrides,
      } as Row,
    ]);

  it('opens a look for 24 hours, with the purpose, and says where', async () => {
    const opened = await service.open(
      'community-1',
      'fleet-1',
      'admin-1',
      'Looking into a complaint',
    );

    expect(opened).toEqual(
      expect.objectContaining({
        communityName: 'Fixture Community',
        communitySlug: 'fixture',
        fleetName: 'Fixture Fleet',
        fleetSlug: 'fixture-fleet',
        platformName: 'PlayStation 5',
        platformSegment: 'playstation-5',
        admin: { userId: 'admin-1', username: 'Quark' },
        purpose: 'Looking into a complaint',
        active: true,
      }),
    );
    expect(opened.expiresAt.getTime() - opened.createdAt.getTime()).toBe(
      FLEET_INVESTIGATION_MS,
    );
  });

  it('refuses a Fleet the Community does not hold', async () => {
    await expect(
      service.open('community-2', 'fleet-1', 'admin-1', 'Looking into it'),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists a site admin’s open looks, soonest to end first', async () => {
    seedGrant({
      id: 'later',
      adminUserId: 'admin-1',
      expiresAt: new Date(Date.now() + 2 * HOUR),
    });
    db.rows(UserProfileEntity).splice(0);
    seedGrant({ id: 'sooner' });
    seedGrant({ id: 'ended', expiresAt: new Date(Date.now() - HOUR) });
    seedGrant({ id: 'theirs', adminUserId: 'admin-2' });

    const mine = await service.mine('admin-1');

    expect(mine.map(each => each.id)).toEqual(['sooner', 'later']);
    expect(mine[0].admin).toEqual({ userId: 'admin-1', username: null });
  });

  it('logs every look, newest first, paged, naming nobody once gone', async () => {
    seedGrant({
      id: 'old',
      createdAt: new Date(Date.now() - 30 * HOUR),
      expiresAt: new Date(Date.now() - 6 * HOUR),
    });
    seedGrant({ id: 'new', adminUserId: null });
    db.rows(FleetCommunityEntity).splice(0);

    const page = await service.log(1, 1);

    expect(page).toEqual(
      expect.objectContaining({ total: 2, page: 1, pageSize: 1 }),
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'new',
        admin: null,
        communityName: null,
        communitySlug: null,
      }),
    ]);

    const second = await service.log(2, 1);

    expect(second.items).toEqual([
      expect.objectContaining({ id: 'old', active: false }),
    ]);
  });

  it('logs nothing when nobody has looked, a page of twenty by default', async () => {
    await expect(service.log()).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });
});
