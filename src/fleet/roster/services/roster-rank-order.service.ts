import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, EntityManager, Repository } from 'typeorm';

import { RosterObservationEntity } from '../../imports/entities/roster-observation.entity';
import { compareText } from '../../projection/utilities/compare-text.utility';
import {
  RosterRankOrderDto,
  UpdateRosterRankOrderDto,
} from '../dto/roster-rank-order.dto';
import { RosterRankOrderActionEntity } from '../entities/roster-rank-order-action.entity';
import { RosterRankOrderEntity } from '../entities/roster-rank-order.entity';

/**
 * A Fleet's rank order: read by the pages that show ranks, and edited by its
 * investigators (FC-020).
 *
 * Read when a page is drawn rather than replayed into a revision (Steve's
 * decision of 25 September 2026), so an edit shows at once. Every edit
 * replaces the whole order, gives a reason, and is kept with the order
 * before and after in `fleet_roster_rank_order_action`.
 *
 * Within a tier the labels have no order, so a tier is always given back
 * sorted and two orders differing only there are the same order.
 */
@Injectable()
export class RosterRankOrderService {
  /**
   * Creates an instance of RosterRankOrderService.
   *
   * @param _rankOrder - Where each rank label sits in each Fleet's order.
   * @param _actions - Every edit to every Fleet's order.
   * @param _dataSource - Runs an edit as one transaction, and reads the
   *   labels the Fleet's imports have listed.
   */
  constructor(
    @InjectRepository(RosterRankOrderEntity)
    private readonly _rankOrder: Repository<RosterRankOrderEntity>,
    @InjectRepository(RosterRankOrderActionEntity)
    private readonly _actions: Repository<RosterRankOrderActionEntity>,
    @InjectDataSource()
    private readonly _dataSource: DataSource,
  ) {}

  /**
   * Reads a Fleet's rank order as a lookup.
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

  /**
   * Reads a Fleet's rank order for its page.
   *
   * @param fleetId - The Fleet.
   * @param investigator - Whether the reader may edit it, and so is shown
   *   the labels to place and every edit.
   * @returns The order.
   */
  async view(
    fleetId: string,
    investigator: boolean,
  ): Promise<RosterRankOrderDto> {
    const tiers = await this.read(this._dataSource.manager, fleetId);

    if (!investigator) {
      return { tiers, labels: null, actions: null };
    }

    const placed = new Map(
      tiers.flatMap((tier, index) => tier.map(label => [label, index + 1])),
    );
    const labels = await this.seen(this._dataSource.manager, fleetId);
    const actions = await this._actions.find({
      where: { fleetId },
      relations: { actor: { profile: true } },
      order: { actedAt: 'DESC', id: 'DESC' },
    });

    return {
      tiers,
      labels: [...labels]
        .sort(compareText)
        .map(label => ({ label, tier: placed.get(label) ?? null })),
      actions: actions.map(action => ({
        id: action.id,
        actorName: action.actor?.profile?.username ?? null,
        reason: action.reason,
        tiersBefore: action.tiersBefore,
        tiersAfter: action.tiersAfter,
        actedAt: action.actedAt,
      })),
    };
  }

  /**
   * Replaces a Fleet's rank order.
   *
   * Under a lock on the Fleet's order, so two edits queue: the second then
   * finds the order is no longer the one it loaded.
   *
   * @param fleetId - The Fleet.
   * @param actorUserId - The investigator.
   * @param edit - The new order, the order as loaded, and why.
   * @returns The order as the investigator now sees it.
   * @throws ConflictException when the order changed since it was loaded.
   * @throws BadRequestException when nothing would change, or the order
   *   places a label none of the Fleet's imports has listed.
   */
  async update(
    fleetId: string,
    actorUserId: string,
    edit: UpdateRosterRankOrderDto,
  ): Promise<RosterRankOrderDto> {
    await this._dataSource.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `fleet-roster-rank-order:${fleetId}`,
      ]);

      const current = await this.read(manager, fleetId);

      if (orderKey(current) !== orderKey(canonical(edit.expected))) {
        throw new ConflictException(
          'The rank order has changed since you loaded it. Reload it and ' +
            'make your change again.',
        );
      }

      const next = canonical(edit.tiers);

      if (orderKey(next) === orderKey(current)) {
        throw new BadRequestException('That is the rank order already.');
      }

      const seen = await this.seen(manager, fleetId);
      const unseen = next.flat().filter(label => !seen.has(label));

      if (unseen.length > 0) {
        throw new BadRequestException(
          'Only labels this Fleet’s imports have listed can be placed. None ' +
            `has listed ${unseen.map(label => `"${label}"`).join(', ')}.`,
        );
      }

      await manager.delete(RosterRankOrderEntity, { fleetId });

      if (next.length > 0) {
        await manager.insert(
          RosterRankOrderEntity,
          next.flatMap((tier, index) =>
            tier.map(label => ({ fleetId, label, tier: index + 1 })),
          ),
        );
      }

      await manager.insert(RosterRankOrderActionEntity, {
        fleetId,
        actorUserId,
        reason: edit.reason,
        tiersBefore: current,
        tiersAfter: next,
      });
    });

    return this.view(fleetId, true);
  }

  /**
   * Reads a Fleet's order as tiers.
   *
   * @param manager - The manager to read through.
   * @param fleetId - The Fleet.
   * @returns Its tiers, highest first, each sorted.
   */
  private async read(
    manager: EntityManager,
    fleetId: string,
  ): Promise<string[][]> {
    const placed = await manager.find(RosterRankOrderEntity, {
      where: { fleetId },
      select: { fleetId: true, label: true, tier: true },
      order: { tier: 'ASC' },
    });
    const tiers = new Map<number, string[]>();

    for (const entry of placed) {
      tiers.set(entry.tier, [...(tiers.get(entry.tier) ?? []), entry.label]);
    }

    return canonical([...tiers.values()]);
  }

  /**
   * Finds every rank label the Fleet's imports have listed.
   *
   * @param manager - The manager to read through.
   * @param fleetId - The Fleet.
   * @returns The labels.
   */
  private async seen(
    manager: EntityManager,
    fleetId: string,
  ): Promise<Set<string>> {
    const rows = await manager
      .getRepository(RosterObservationEntity)
      .createQueryBuilder('o')
      .select('DISTINCT o.guildRank', 'label')
      .where('o.fleetId = :fleetId', { fleetId })
      .getRawMany<{ label: string }>();

    return new Set(rows.map(row => row.label));
  }
}

/**
 * Sorts the labels within each tier, which have no order of their own.
 *
 * @param tiers - The tiers, highest first.
 * @returns The same tiers, each sorted.
 */
function canonical(tiers: readonly string[][]): string[][] {
  return tiers.map(tier => [...tier].sort(compareText));
}

/**
 * Keys an order for comparison.
 *
 * @param tiers - The order, already canonical.
 * @returns The key.
 */
function orderKey(tiers: readonly string[][]): string {
  return JSON.stringify(tiers);
}
