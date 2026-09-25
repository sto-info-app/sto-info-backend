import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { RosterRankOrderEntity } from '../entities/roster-rank-order.entity';

/**
 * A Fleet's rank order, as the pages that read it need it (FC-020).
 *
 * Read when a page is drawn rather than replayed into a revision (Steve's
 * decision of 25 September 2026), so an edit shows at once.
 */
@Injectable()
export class RosterRankOrderService {
  /**
   * Creates an instance of RosterRankOrderService.
   *
   * @param _rankOrder - Where each rank label sits in each Fleet's order.
   */
  constructor(
    @InjectRepository(RosterRankOrderEntity)
    private readonly _rankOrder: Repository<RosterRankOrderEntity>,
  ) {}

  /**
   * Reads a Fleet's rank order.
   *
   * @param fleetId - The Fleet.
   * @returns Each placed label's tier, 1 the highest. Empty when the Fleet
   *   has no order.
   */
  async tiers(fleetId: string): Promise<Map<string, number>> {
    const placed = await this._rankOrder.find({
      where: { fleetId },
      select: { fleetId: true, label: true, tier: true },
    });

    return new Map(placed.map(entry => [entry.label, entry.tier]));
  }
}
