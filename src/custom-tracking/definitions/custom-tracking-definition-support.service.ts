import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import {
  EntityManager,
  FindOptionsWhere,
  IsNull,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import { StorytimeOrderingService } from '../../storytime/shared/storytime-ordering.service';
import { CUSTOM_TRACKING_LIMITS } from '../constants/custom-tracking-limits.constants';
import {
  CustomTrackingLimitName,
  CustomTrackingObservabilityService,
} from '../observability/custom-tracking-observability.service';

/**
 * A row that can be counted, named and ordered among its siblings.
 *
 * Deliberately structural rather than a shared base class. The four definition
 * levels have nothing in common at the database — different tables, different
 * parents, different columns — and inheriting from one another would tie them
 * together for the sake of four properties they happen to share.
 */
export interface CustomTrackingOrderedRow extends ObjectLiteral {
  id: string;
  orderIndex: number;
}

/** One request for room in a collection that has a ceiling. */
export interface CustomTrackingRoomRequest {
  /** Whose request it is. */
  userId: string;
  /** How many they already have. */
  used: number;
  /** Which ceiling applies. */
  limit: CustomTrackingLimitName;
  /** What to tell them when there is no room. */
  message: string;
}

/**
 * The rules every level of the definition hierarchy is held to.
 *
 * Sections, Tabs, Fields and options each have a parent, a name that must be
 * unique among its siblings, a ceiling on how many may exist, and a position.
 * Those four rules are written once here and applied to each level, because
 * four copies of "is this name taken" is how one of them comes to compare
 * without folding case while the others do.
 *
 * Every method takes the repository it is to work against. That is what lets
 * one implementation serve four tables without a generic base class the
 * entities would all have to inherit from.
 */
@Injectable()
export class CustomTrackingDefinitionSupportService {
  /**
   * Creates an instance of CustomTrackingDefinitionSupportService.
   *
   * @param _ordering - Calculates positions within an ordered collection.
   * @param _observability - Records the ceilings requests run into.
   */
  constructor(
    private readonly _ordering: StorytimeOrderingService,
    private readonly _observability: CustomTrackingObservabilityService,
  ) {}

  /**
   * Counts the live rows under a parent.
   *
   * @param repository - The table to count in.
   * @param where - What identifies the siblings.
   * @returns How many are not deleted.
   */
  countActive<T extends CustomTrackingOrderedRow>(
    repository: Repository<T>,
    where: FindOptionsWhere<T>,
  ): Promise<number> {
    return repository.count({
      where: { ...where, deletedAt: IsNull() } as FindOptionsWhere<T>,
    });
  }

  /**
   * Requires a collection to have room for one more.
   *
   * The count and the insert are not one operation, so two requests arriving
   * together can both pass this. That is accepted deliberately: the failure
   * mode is one Section too many rather than anything unsafe, and the
   * alternative — locking the whole collection on every create — would cost
   * every ordinary request to prevent something no real user does.
   *
   * The ceiling arrives as its name rather than its number, so the refusal can
   * say which one it was without the caller writing that name out a second
   * time beside the value. Two spellings of the same limit is how a log ends
   * up counting a ceiling nobody has.
   *
   * @param request - Who is asking, how many they have, and which ceiling
   *   applies.
   * @throws ConflictException when the collection is full.
   */
  assertRoomFor(request: CustomTrackingRoomRequest): void {
    if (request.used < CUSTOM_TRACKING_LIMITS[request.limit]) {
      return;
    }

    this._observability.limitReached(
      request.userId,
      request.limit,
      request.used,
    );

    throw new ConflictException(request.message);
  }

  /**
   * Requires a name to be unused among its live siblings.
   *
   * A courtesy rather than the guarantee. The partial unique index is what
   * actually refuses a duplicate, including the pair of simultaneous requests
   * that would both pass this check; doing it here as well is what turns a
   * database error into a sentence the user can act on.
   *
   * @param repository - The table to look in.
   * @param where - What identifies the siblings, including the normalised name.
   * @param message - What to tell the user when the name is taken.
   * @throws ConflictException when a live sibling already has that name.
   */
  async assertNameAvailable<T extends CustomTrackingOrderedRow>(
    repository: Repository<T>,
    where: FindOptionsWhere<T>,
    message: string,
  ): Promise<void> {
    const existing = await repository.findOne({
      where: { ...where, deletedAt: IsNull() } as FindOptionsWhere<T>,
      select: { id: true } as never,
    });

    if (existing) {
      throw new ConflictException(message);
    }
  }

  /**
   * Returns the position a new row should take at the end of its collection.
   *
   * @param repository - The table to look in.
   * @param where - What identifies the siblings.
   * @returns The position for the new row.
   */
  async nextOrderIndex<T extends CustomTrackingOrderedRow>(
    repository: Repository<T>,
    where: FindOptionsWhere<T>,
  ): Promise<number> {
    const last = await repository.findOne({
      where: { ...where, deletedAt: IsNull() } as FindOptionsWhere<T>,
      order: { orderIndex: 'DESC' } as never,
      select: { orderIndex: true } as never,
    });

    return this._ordering.nextIndex(last?.orderIndex ?? null);
  }

  /**
   * Puts a collection into the order the caller asked for.
   *
   * The whole ordered list of siblings is required, not a single item's new
   * position. A request that named one row and a number could ask for an order
   * nobody could see the consequences of — two rows sharing a position, or a
   * row placed beyond its collection — whereas a complete list either
   * describes the collection exactly or does not, and the mismatch says which.
   *
   * That check is also what stops a row being dragged into somebody else's
   * collection: an identifier belonging elsewhere is not among the siblings
   * loaded here, so it reads as an unknown row rather than as a move.
   *
   * @param manager - The transaction to write in.
   * @param repository - The table being ordered.
   * @param where - What identifies the siblings.
   * @param orderedIds - Every live sibling, in the order they should end up.
   * @throws BadRequestException when the list is not exactly the collection.
   */
  async reorder<T extends CustomTrackingOrderedRow>(
    manager: EntityManager,
    repository: Repository<T>,
    where: FindOptionsWhere<T>,
    orderedIds: string[],
  ): Promise<void> {
    const siblings = await manager.find(repository.target, {
      where: { ...where, deletedAt: IsNull() } as FindOptionsWhere<T>,
      select: { id: true } as never,
    });

    this.assertCompleteOrder(
      siblings.map(sibling => (sibling as CustomTrackingOrderedRow).id),
      orderedIds,
    );

    for (const placement of this._ordering.renumber(orderedIds)) {
      await manager.update(repository.target, placement.id, {
        orderIndex: placement.orderIndex,
      } as never);
    }
  }

  /**
   * Requires a requested order to describe its collection exactly.
   *
   * @param actualIds - Every live sibling.
   * @param orderedIds - The order requested.
   * @throws BadRequestException when the two do not match.
   */
  private assertCompleteOrder(actualIds: string[], orderedIds: string[]): void {
    const requested = new Set(orderedIds);

    if (requested.size !== orderedIds.length) {
      throw new BadRequestException(
        'The new order lists the same item more than once.',
      );
    }

    if (requested.size !== actualIds.length) {
      throw new BadRequestException(
        'The new order has to list every item in this group exactly once.',
      );
    }

    const missing = actualIds.filter(id => !requested.has(id));

    if (missing.length > 0) {
      throw new BadRequestException(
        'The new order has to list every item in this group exactly once.',
      );
    }
  }
}
