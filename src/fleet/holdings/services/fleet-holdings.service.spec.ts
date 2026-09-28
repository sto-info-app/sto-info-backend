import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DataSource } from 'typeorm';

import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import { RecordFleetHoldingDto } from '../dto/fleet-holdings.dto';
import { FleetHoldingChangeEntity } from '../entities/fleet-holding-change.entity';
import { FleetHoldingHistoryEntity } from '../entities/fleet-holding-history.entity';
import { FleetHoldingStatusEntity } from '../entities/fleet-holding-status.entity';
import { FleetHoldingTierEntity } from '../entities/fleet-holding-tier.entity';
import { FleetHoldingTrackEntity } from '../entities/fleet-holding-track.entity';
import { FleetHoldingTypeEntity } from '../entities/fleet-holding-type.entity';
import { FleetHoldingsService } from './fleet-holdings.service';

const COMMUNITY_ID = '23000000-0000-4000-8000-000000000001';
const FLEET_ID = '23000000-0000-4000-8000-000000000002';
const RECORDER_ID = '23000000-0000-4000-8000-000000000003';
const GONE_ID = '23000000-0000-4000-8000-000000000004';

/** Two holdings, the second listed first so ordering is by position. */
const HOLDINGS = [
  {
    code: 'EMBASSY',
    name: 'Fleet Embassy',
    position: 2,
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Embassy',
    sourceEditedOn: '2024-08-29',
    catalogueVersion: 1,
  },
  {
    code: 'STARBASE',
    name: 'Fleet Starbase',
    position: 1,
    sourceUrl: 'https://stowiki.net/wiki/Fleet_Starbase',
    sourceEditedOn: '2026-07-05',
    catalogueVersion: 2,
  },
] as FleetHoldingTypeEntity[];

const TRACKS = [
  ['STARBASE_MILITARY', 'STARBASE', 'Military', true, 2],
  ['STARBASE', 'STARBASE', 'Starbase', false, 1],
  ['EMBASSY', 'EMBASSY', 'Embassy', false, 1],
  // Listed in no tier row: read as able to be at 0 alone.
  ['EMBASSY_DIPLOMACY', 'EMBASSY', 'Diplomacy', true, 2],
].map(([code, holdingTypeCode, name, isDepartment, position]) => ({
  code,
  holdingTypeCode,
  name,
  isDepartment,
  position,
})) as FleetHoldingTrackEntity[];

const TIERS = [
  ...[0, 1, 2, 3, 4, 5].map(tier => ({ trackCode: 'STARBASE', tier })),
  ...[0, 1, 2, 3, 4, 5].map(tier => ({
    trackCode: 'STARBASE_MILITARY',
    tier,
  })),
  ...[0, 1, 2, 3].map(tier => ({ trackCode: 'EMBASSY', tier })),
] as FleetHoldingTierEntity[];

/**
 * Sorts rows by a numeric column, as the database would.
 *
 * @param rows - The rows.
 * @returns A sorted copy.
 */
function byPosition<T extends { position: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

describe('FleetHoldingsService', () => {
  let fleet: StoFleetEntity;
  let statuses: FleetHoldingStatusEntity[];
  let changes: FleetHoldingChangeEntity[];
  let moves: FleetHoldingHistoryEntity[];
  let profiles: { userId: string; username: string }[];
  let lockedFleet: StoFleetEntity | null;
  let manager: {
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    insert: jest.Mock;
    upsert: jest.Mock;
  };
  let authorise: jest.Mock;
  let service: FleetHoldingsService;

  beforeEach(() => {
    fleet = {
      id: FLEET_ID,
      communityId: COMMUNITY_ID,
      status: FleetScopeStatus.ACTIVE,
    } as StoFleetEntity;
    lockedFleet = fleet;
    statuses = [];
    changes = [];
    moves = [];
    profiles = [];
    manager = {
      find: jest.fn((entity: unknown) => {
        switch (entity) {
          case FleetHoldingTypeEntity:
            return Promise.resolve(byPosition(HOLDINGS));
          case FleetHoldingTrackEntity:
            return Promise.resolve(byPosition(TRACKS));
          case FleetHoldingTierEntity:
            return Promise.resolve(TIERS);
          case FleetHoldingStatusEntity:
            return Promise.resolve(statuses);
          case FleetHoldingHistoryEntity:
            return Promise.resolve(moves);
          case UserProfileEntity:
            return Promise.resolve(profiles);
          default:
            throw new Error('Unexpected entity');
        }
      }),
      findAndCount: jest.fn(() => Promise.resolve([changes, 40])),
      findOne: jest.fn(() => Promise.resolve(lockedFleet)),
      create: jest.fn((_entity: unknown, row: object) => row),
      save: jest.fn((row: object) =>
        Promise.resolve({ id: 'change-1', ...row }),
      ),
      insert: jest.fn(() => Promise.resolve()),
      upsert: jest.fn(() => Promise.resolve()),
    };
    authorise = jest.fn(() => Promise.resolve(null));
    service = new FleetHoldingsService(
      {
        manager,
        transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      } as unknown as DataSource,
      { authorise } as unknown as FleetAuthorisationService,
    );
  });

  /**
   * Gives the viewer some capabilities at the Fleet.
   *
   * @param capabilities - What they hold.
   */
  function holding(...capabilities: string[]): void {
    authorise.mockResolvedValue({ capabilities: new Set(capabilities) });
  }

  describe('reading where the holdings stand', () => {
    it('lists every holding in order, at tier 0 until recorded', async () => {
      const updatedAt = new Date('2026-09-28T10:00:00Z');

      statuses = [
        {
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'STARBASE',
          trackCode: 'STARBASE_MILITARY',
          tier: 4,
          updatedAt,
        },
      ];

      const view = await service.view(fleet, null);

      expect(authorise).not.toHaveBeenCalled();
      expect(view.catalogueVersion).toBe(2);
      expect(view.mayRecord).toBe(false);
      expect(view.holdings.map(entry => entry.code)).toEqual([
        'STARBASE',
        'EMBASSY',
      ]);
      expect(view.holdings[0]).toEqual({
        code: 'STARBASE',
        name: 'Fleet Starbase',
        sourceUrl: 'https://stowiki.net/wiki/Fleet_Starbase',
        sourceEditedOn: '2026-07-05',
        tracks: [
          {
            code: 'STARBASE',
            name: 'Starbase',
            isDepartment: false,
            maxTier: 5,
            tier: 0,
            updatedAt: null,
          },
          {
            code: 'STARBASE_MILITARY',
            name: 'Military',
            isDepartment: true,
            maxTier: 5,
            tier: 4,
            updatedAt,
          },
        ],
      });
      expect(view.holdings[1].tracks.map(track => track.maxTier)).toEqual([
        3, 0,
      ]);
    });

    it.each([
      ['a holdings.write holder at an open Fleet', true, 'ACTIVE', true],
      ['a holdings.write holder at a closed Fleet', true, 'CLOSED', false],
      ['anybody else', false, 'ACTIVE', false],
    ])('offers recording to %s: %s', async (_who, writes, status, expected) => {
      fleet.status = status as FleetScopeStatus;
      holding(...(writes ? [FLEET_CAPABILITIES.HOLDINGS_WRITE] : []));

      const view = await service.view(fleet, RECORDER_ID);

      expect(authorise).toHaveBeenCalledWith(RECORDER_ID, {
        kind: FleetScopeKind.FLEET,
        id: FLEET_ID,
      });
      expect(view.mayRecord).toBe(expected);
    });

    it('treats a viewer with no standing as holding nothing', async () => {
      const view = await service.view(fleet, RECORDER_ID);

      expect(view.mayRecord).toBe(false);
    });
  });

  describe('reading the history', () => {
    beforeEach(() => {
      changes = [
        {
          id: 'change-2',
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'STARBASE',
          actorUserId: RECORDER_ID,
          reason: 'Upgraded tonight',
          createdAt: new Date('2026-09-28T20:00:00Z'),
        },
        {
          id: 'change-1',
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'EMBASSY',
          actorUserId: GONE_ID,
          reason: null,
          createdAt: new Date('2026-09-27T20:00:00Z'),
        },
        {
          id: 'change-0',
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'EMBASSY',
          actorUserId: null,
          reason: null,
          createdAt: new Date('2026-09-26T20:00:00Z'),
        },
      ];
      moves = [
        ['change-2', 'STARBASE', 'STARBASE_MILITARY', 2, 3],
        ['change-2', 'STARBASE', 'STARBASE', 1, 2],
        ['change-1', 'EMBASSY', 'EMBASSY', 3, 1],
        ['change-0', 'EMBASSY', 'EMBASSY', 0, 3],
      ].map(([changeId, holdingTypeCode, trackCode, tierBefore, tier]) => ({
        id: `${changeId as string}-${trackCode as string}`,
        changeId,
        fleetId: FLEET_ID,
        holdingTypeCode,
        trackCode,
        tierBefore,
        tier,
      })) as FleetHoldingHistoryEntity[];
      profiles = [{ userId: RECORDER_ID, username: 'MidNiteShadow' }];
    });

    it('names the recorder to a Fleet member, and puts each change in order', async () => {
      holding(FLEET_CAPABILITIES.ROSTER_VIEW);

      const page = await service.history(fleet, RECORDER_ID, {
        page: 2,
        pageSize: 3,
      });

      expect(manager.findAndCount).toHaveBeenCalledWith(
        FleetHoldingChangeEntity,
        expect.objectContaining({
          where: { fleetId: FLEET_ID },
          order: { createdAt: 'DESC', id: 'DESC' },
          skip: 3,
          take: 3,
        }),
      );
      expect(page).toMatchObject({
        recordersShown: true,
        page: 2,
        pageSize: 3,
        total: 40,
      });
      expect(page.items[0]).toEqual({
        id: 'change-2',
        holdingCode: 'STARBASE',
        holdingName: 'Fleet Starbase',
        recordedAt: new Date('2026-09-28T20:00:00Z'),
        recordedBy: 'MidNiteShadow',
        reason: 'Upgraded tonight',
        moves: [
          {
            track: 'STARBASE',
            trackName: 'Starbase',
            isDepartment: false,
            from: 1,
            to: 2,
          },
          {
            track: 'STARBASE_MILITARY',
            trackName: 'Military',
            isDepartment: true,
            from: 2,
            to: 3,
          },
        ],
      });
      // No username, and an account that has gone.
      expect(page.items.slice(1).map(item => item.recordedBy)).toEqual([
        null,
        null,
      ]);
    });

    it('names nobody to anybody else, and pages from the first by default', async () => {
      const page = await service.history(fleet, null, {});

      expect(manager.findAndCount).toHaveBeenCalledWith(
        FleetHoldingChangeEntity,
        expect.objectContaining({ skip: 0, take: 25 }),
      );
      expect(page.recordersShown).toBe(false);
      expect(page.items.map(item => item.recordedBy)).toEqual([
        null,
        null,
        null,
      ]);
      expect(manager.find).not.toHaveBeenCalledWith(
        UserProfileEntity,
        expect.anything(),
      );
    });

    it('shows a recorder to a holdings.write holder', async () => {
      holding(FLEET_CAPABILITIES.HOLDINGS_WRITE);

      const page = await service.history(fleet, RECORDER_ID, {});

      expect(page.recordersShown).toBe(true);
    });

    it('reads no moves for a page with no changes', async () => {
      changes = [];

      const page = await service.history(fleet, null, {});

      expect(page.items).toEqual([]);
      expect(manager.find).not.toHaveBeenCalledWith(
        FleetHoldingHistoryEntity,
        expect.anything(),
      );
    });
  });

  describe('recording tiers', () => {
    /**
     * Records the Starbase's tracks.
     *
     * @param tiers - The tracks and tiers to send.
     * @param reason - Why.
     * @param holdingCode - The holding.
     * @returns The pending save.
     */
    const record = (
      tiers: [string, number][],
      reason?: string,
      holdingCode = 'STARBASE',
    ): Promise<void> =>
      service.record(
        COMMUNITY_ID,
        FLEET_ID,
        holdingCode,
        {
          tiers: tiers.map(([track, tier]) => ({ track, tier })),
          reason,
        } as RecordFleetHoldingDto,
        RECORDER_ID,
      );

    it('locks the Fleet, then records each track it moves, in the holding’s order', async () => {
      statuses = [
        {
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'STARBASE',
          trackCode: 'STARBASE',
          tier: 2,
          updatedAt: new Date(),
        },
      ];

      await record(
        [
          ['STARBASE_MILITARY', 3],
          ['STARBASE', 1],
        ],
        '  Corrected  ',
      );

      expect(manager.findOne).toHaveBeenCalledWith(
        StoFleetEntity,
        expect.objectContaining({
          where: expect.objectContaining({
            id: FLEET_ID,
            communityId: COMMUNITY_ID,
          }),
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(manager.create).toHaveBeenCalledWith(
        FleetHoldingChangeEntity,
        expect.objectContaining({
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'STARBASE',
          actorUserId: RECORDER_ID,
          reason: 'Corrected',
        }),
      );
      expect(manager.insert).toHaveBeenCalledWith(FleetHoldingHistoryEntity, [
        expect.objectContaining({
          changeId: 'change-1',
          trackCode: 'STARBASE',
          tierBefore: 2,
          tier: 1,
        }),
        expect.objectContaining({
          trackCode: 'STARBASE_MILITARY',
          tierBefore: 0,
          tier: 3,
        }),
      ]);
      expect(manager.upsert).toHaveBeenCalledWith(
        FleetHoldingStatusEntity,
        [
          expect.objectContaining({ trackCode: 'STARBASE', tier: 1 }),
          expect.objectContaining({ trackCode: 'STARBASE_MILITARY', tier: 3 }),
        ],
        ['fleetId', 'trackCode'],
      );
    });

    it('keeps no reason when none is given', async () => {
      await record([['STARBASE', 5]], '   ');

      expect(manager.create).toHaveBeenCalledWith(
        FleetHoldingChangeEntity,
        expect.objectContaining({ reason: null }),
      );
    });

    it('records only the tracks that move', async () => {
      statuses = [
        {
          fleetId: FLEET_ID,
          communityId: COMMUNITY_ID,
          holdingTypeCode: 'STARBASE',
          trackCode: 'STARBASE',
          tier: 2,
          updatedAt: new Date(),
        },
      ];

      await record([
        ['STARBASE', 2],
        ['STARBASE_MILITARY', 1],
      ]);

      expect(manager.insert).toHaveBeenCalledWith(FleetHoldingHistoryEntity, [
        expect.objectContaining({ trackCode: 'STARBASE_MILITARY' }),
      ]);
    });

    it('refuses a Fleet it cannot find', async () => {
      lockedFleet = null;

      await expect(record([['STARBASE', 1]])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses a closed Fleet', async () => {
      fleet.status = FleetScopeStatus.CLOSED;

      await expect(record([['STARBASE', 1]])).rejects.toThrow(
        new ConflictException(
          'This Fleet is closed, so its holdings cannot change.',
        ),
      );
    });

    it('refuses a holding the catalogue does not have', async () => {
      await expect(record([['SPIRE', 1]], undefined, 'SPIRE')).rejects.toThrow(
        new NotFoundException('No such holding.'),
      );
    });

    it.each([
      [
        'a track of another holding',
        [['EMBASSY', 1]],
        'Fleet Starbase has no track EMBASSY.',
      ],
      [
        'a track named twice',
        [
          ['STARBASE', 1],
          ['STARBASE', 2],
        ],
        'Starbase is given more than once.',
      ],
      [
        'a tier out of bounds',
        [['STARBASE_MILITARY', 6]],
        'Military goes from tier 0 to 5.',
      ],
      ['nothing to change', [['STARBASE', 0]], 'Nothing has changed.'],
    ])('refuses %s', async (_what, tiers, message) => {
      await expect(record(tiers as [string, number][])).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });
});
