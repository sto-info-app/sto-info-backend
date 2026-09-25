import { Repository } from 'typeorm';

import { RosterRankOrderEntity } from '../entities/roster-rank-order.entity';
import { RosterRankOrderService } from './roster-rank-order.service';

describe('RosterRankOrderService', () => {
  let rankOrder: { find: jest.Mock };
  let service: RosterRankOrderService;

  beforeEach(() => {
    rankOrder = {
      find: jest.fn(() =>
        Promise.resolve([
          { fleetId: 'fleet-1', label: 'Officer', tier: 1 },
          { fleetId: 'fleet-1', label: 'Member', tier: 2 },
          { fleetId: 'fleet-1', label: 'Recruit', tier: 2 },
        ]),
      ),
    };
    service = new RosterRankOrderService(
      rankOrder as unknown as Repository<RosterRankOrderEntity>,
    );
  });

  it('reads each placed label’s tier', async () => {
    await expect(service.tiers('fleet-1')).resolves.toEqual(
      new Map([
        ['Officer', 1],
        ['Member', 2],
        ['Recruit', 2],
      ]),
    );
    expect(rankOrder.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fleetId: 'fleet-1' } }),
    );
  });

  it('reads a Fleet with no order as having none', async () => {
    rankOrder.find.mockResolvedValue([]);

    await expect(service.tiers('fleet-1')).resolves.toEqual(new Map());
  });
});
