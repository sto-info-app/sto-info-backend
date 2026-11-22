import { BadRequestException, ConflictException } from '@nestjs/common';

import { DataSource, Repository } from 'typeorm';

import { RosterRankOrderActionEntity } from '../entities/roster-rank-order-action.entity';
import { RosterRankOrderEntity } from '../entities/roster-rank-order.entity';
import { RosterRankOrderService } from './roster-rank-order.service';

const FLEET_ID = 'fleet-1';
const ACTED_AT = new Date('2026-09-25T12:00:00Z');

/** The order the Fleet has: Officer above Member and Recruit. */
const PLACED = [
  { fleetId: FLEET_ID, label: 'Officer', tier: 1 },
  { fleetId: FLEET_ID, label: 'Recruit', tier: 2 },
  { fleetId: FLEET_ID, label: 'Member', tier: 2 },
];

describe('RosterRankOrderService', () => {
  let rankOrder: { find: jest.Mock };
  let actions: { find: jest.Mock };
  let seenBuilder: Record<string, jest.Mock>;
  let manager: {
    find: jest.Mock;
    query: jest.Mock;
    delete: jest.Mock;
    insert: jest.Mock;
    getRepository: jest.Mock;
  };
  let dataSource: { manager: typeof manager; transaction: jest.Mock };
  let service: RosterRankOrderService;

  beforeEach(() => {
    rankOrder = { find: jest.fn(() => Promise.resolve(PLACED)) };
    actions = {
      find: jest.fn(() =>
        Promise.resolve([
          {
            id: 'action-2',
            actor: { profile: { username: 'MidNiteShadow' } },
            reason: 'Recruits sit with members',
            tiersBefore: [['Officer'], ['Member']],
            tiersAfter: [['Officer'], ['Member', 'Recruit']],
            actedAt: ACTED_AT,
          },
          {
            id: 'action-1',
            actor: null,
            reason: 'First order',
            tiersBefore: [],
            tiersAfter: [['Officer'], ['Member']],
            actedAt: ACTED_AT,
          },
        ]),
      ),
    };
    seenBuilder = {};

    for (const method of ['select', 'where']) {
      seenBuilder[method] = jest.fn(() => seenBuilder);
    }

    seenBuilder.getRawMany = jest.fn(() =>
      Promise.resolve([
        { label: 'Recruit' },
        { label: 'Officer' },
        { label: 'Cadet' },
        { label: 'Member' },
      ]),
    );
    manager = {
      find: jest.fn(() => Promise.resolve(PLACED)),
      query: jest.fn(() => Promise.resolve([])),
      delete: jest.fn(() => Promise.resolve({ affected: 3 })),
      insert: jest.fn(() => Promise.resolve({})),
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => seenBuilder),
      })),
    };
    dataSource = {
      manager,
      transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    service = new RosterRankOrderService(
      rankOrder as unknown as Repository<RosterRankOrderEntity>,
      actions as unknown as Repository<RosterRankOrderActionEntity>,
      dataSource as unknown as DataSource,
    );
  });

  describe('tiers', () => {
    it('reads each placed label’s tier', async () => {
      await expect(service.tiers(FLEET_ID)).resolves.toEqual(
        new Map([
          ['Officer', 1],
          ['Recruit', 2],
          ['Member', 2],
        ]),
      );
      expect(rankOrder.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fleetId: FLEET_ID } }),
      );
    });
  });

  describe('view', () => {
    it('shows a reader the tiers alone, each sorted', async () => {
      await expect(service.view(FLEET_ID, false)).resolves.toEqual({
        tiers: [['Officer'], ['Member', 'Recruit']],
        labels: null,
        actions: null,
      });
      expect(actions.find).not.toHaveBeenCalled();
      expect(manager.getRepository).not.toHaveBeenCalled();
    });

    it('shows an investigator every label seen and every edit', async () => {
      const view = await service.view(FLEET_ID, true);

      expect(view.labels).toEqual([
        { label: 'Cadet', tier: null },
        { label: 'Member', tier: 2 },
        { label: 'Officer', tier: 1 },
        { label: 'Recruit', tier: 2 },
      ]);
      expect(view.actions).toEqual([
        {
          id: 'action-2',
          actorName: 'MidNiteShadow',
          reason: 'Recruits sit with members',
          tiersBefore: [['Officer'], ['Member']],
          tiersAfter: [['Officer'], ['Member', 'Recruit']],
          actedAt: ACTED_AT,
        },
        expect.objectContaining({ id: 'action-1', actorName: null }),
      ]);
      expect(seenBuilder.select).toHaveBeenCalledWith(
        'DISTINCT o.guildRank',
        'label',
      );
      expect(seenBuilder.where).toHaveBeenCalledWith('o.fleetId = :fleetId', {
        fleetId: FLEET_ID,
      });
    });

    it('reads a Fleet with no order as no tiers', async () => {
      manager.find.mockResolvedValue([]);

      await expect(service.view(FLEET_ID, false)).resolves.toMatchObject({
        tiers: [],
      });
    });
  });

  describe('update', () => {
    const edit = {
      tiers: [['Officer'], ['Member'], ['Recruit', 'Cadet']],
      expected: [['Officer'], ['Recruit', 'Member']],
      reason: 'Recruits and cadets are below members',
    };

    it('replaces the order under the Fleet’s lock and records why', async () => {
      await service.update(FLEET_ID, 'user-1', edit);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`fleet-roster-rank-order:${FLEET_ID}`],
      );
      expect(manager.delete).toHaveBeenCalledWith(RosterRankOrderEntity, {
        fleetId: FLEET_ID,
      });
      expect(manager.insert).toHaveBeenCalledWith(RosterRankOrderEntity, [
        { fleetId: FLEET_ID, label: 'Officer', tier: 1 },
        { fleetId: FLEET_ID, label: 'Member', tier: 2 },
        { fleetId: FLEET_ID, label: 'Cadet', tier: 3 },
        { fleetId: FLEET_ID, label: 'Recruit', tier: 3 },
      ]);
      expect(manager.insert).toHaveBeenCalledWith(RosterRankOrderActionEntity, {
        fleetId: FLEET_ID,
        actorUserId: 'user-1',
        reason: 'Recruits and cadets are below members',
        tiersBefore: [['Officer'], ['Member', 'Recruit']],
        tiersAfter: [['Officer'], ['Member'], ['Cadet', 'Recruit']],
      });
    });

    it('gives back the order as the investigator now sees it', async () => {
      await expect(
        service.update(FLEET_ID, 'user-1', edit),
      ).resolves.toMatchObject({ labels: expect.any(Array) as unknown });
    });

    it('clears the order', async () => {
      await service.update(FLEET_ID, 'user-1', { ...edit, tiers: [] });

      expect(manager.delete).toHaveBeenCalled();
      expect(manager.insert).toHaveBeenCalledTimes(1);
      expect(manager.insert).toHaveBeenCalledWith(
        RosterRankOrderActionEntity,
        expect.objectContaining({ tiersAfter: [] }),
      );
    });

    it('refuses an edit made to an order that has changed since', async () => {
      await expect(
        service.update(FLEET_ID, 'user-1', {
          ...edit,
          expected: [['Officer']],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('refuses an edit that changes nothing', async () => {
      await expect(
        service.update(FLEET_ID, 'user-1', {
          ...edit,
          tiers: [['Officer'], ['Recruit', 'Member']],
        }),
      ).rejects.toThrow(
        new BadRequestException('That is the rank order already.'),
      );
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('refuses a label no import of the Fleet has listed, naming it', async () => {
      await expect(
        service.update(FLEET_ID, 'user-1', {
          ...edit,
          tiers: [['Admiral'], ['Officer'], ['Ghost']],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Only labels this Fleet’s imports have listed can be placed. None ' +
            'has listed "Admiral", "Ghost".',
        ),
      );
      expect(manager.delete).not.toHaveBeenCalled();
    });
  });
});
