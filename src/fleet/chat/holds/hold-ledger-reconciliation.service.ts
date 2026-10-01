import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  MoreThan,
  QueryFailedError,
} from 'typeorm';

import {
  eachLimited,
  LEDGER_CHUNK_SIZE,
  LEDGER_CONCURRENCY,
  LedgerReconciliation,
  noTimings,
  timed,
} from 'src/shared/ledger/ledger.utility';
import { UserEntity } from 'src/user/entities/user.entity';

import { ChatMessageReportEntity } from '../entities/chat-message-report.entity';
import {
  HoldLedgerService,
  HoldMarker,
  LEDGERED_HOLD_ACTIONS,
} from './hold-ledger.service';
import { ModerationHoldActionEntity } from './moderation-hold-action.entity';
import { ModerationHoldEntity } from './moderation-hold.entity';
import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';

/**
 * Why a hold, or an event of one, the database had lost was made again:
 * the ledger keeps no reason (Steve's decision of 30 September 2026).
 */
export const HOLD_REPLAYED_REASON =
  'Brought back from the hold ledger after a restore.';

/** What the check did about one event the database lacked. */
type HoldOutcome = 'replayed' | 'alreadyHeld' | 'nothingToHold' | 'notInForce';

/**
 * Checks the hold ledger against the database, at boot (FC-042).
 *
 * The ledger is read by its keys, and the log a chunk at a time. Each event
 * the database lacks is brought back, oldest first, under its own ID, with
 * no actor and {@link HOLD_REPLAYED_REASON}:
 *
 * - **Placed:** the hold is made again with its own ID, if its report or
 *   member is still there — otherwise there is nothing left to hold. A hold
 *   already in force on the same thing counts as held.
 * - **Extended:** its review date is set, if it is still in force.
 * - **Released:** it is released, when it was, if it is still in force.
 *
 * Every placing, extension and release in the log with no marker gets one,
 * so the ledger is complete after the first boot that runs this.
 */
@Injectable()
export class HoldLedgerReconciliationService {
  private readonly _logger = new Logger(HoldLedgerReconciliationService.name);

  /**
   * Creates an instance of HoldLedgerReconciliationService.
   *
   * @param _dataSource - The database.
   * @param _ledger - The hold ledger.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _ledger: HoldLedgerService,
  ) {}

  /**
   * Compares the ledger with the database, brings back every event the
   * database lacks and writes a marker for every event the ledger lacks.
   *
   * @returns What the check came to.
   */
  async reconcile(): Promise<LedgerReconciliation> {
    const timings = noTimings();
    const keys = await timed(timings, 'list', () => this._ledger.listKeys());
    const { lacking, unmarked } = await timed(timings, 'compare', async () => {
      const logged = await this.loggedEvents();
      const ids = new Set(logged.map(({ action }) => action.id));
      const marked = new Set(keys.map(key => key.id));

      return {
        lacking: keys.filter(key => !ids.has(key.id)),
        unmarked: logged.filter(({ action }) => !marked.has(action.id)),
      };
    });
    const counts: Record<HoldOutcome, number> = {
      replayed: 0,
      alreadyHeld: 0,
      nothingToHold: 0,
      notInForce: 0,
    };

    await timed(timings, 'replay', async () => {
      for (const key of lacking) {
        counts[await this.replay(await this._ledger.read(key.key))]++;
      }
    });

    const backfilled = await timed(timings, 'backfill', async () => {
      await eachLimited(unmarked, LEDGER_CONCURRENCY, ({ action, hold }) =>
        this._ledger.write({
          actionId: action.id,
          holdId: hold.id,
          kind: action.action,
          holdKind: hold.kind,
          chatReportId: hold.chatReportId,
          subjectUserId: hold.subjectUserId,
          ownerUserId: hold.ownerUserId,
          reviewAt: reviewAtOf(action, hold),
          createdAt: action.createdAt.toISOString(),
        }),
      );

      return unmarked.length;
    });

    this._logger.log(
      `[reconcile] Hold ledger checked - Markers: ${keys.length}, ` +
        `Replayed: ${counts.replayed}, AlreadyHeld: ${counts.alreadyHeld}, ` +
        `NothingToHold: ${counts.nothingToHold}, ` +
        `NotInForce: ${counts.notInForce}, Backfilled: ${backfilled}`,
    );

    return {
      markers: keys.length,
      replayed: counts.replayed,
      backfilled,
      detail: counts,
      timings,
    };
  }

  /**
   * Brings back one event.
   *
   * @param marker - The event.
   * @returns What was done.
   */
  private async replay(marker: HoldMarker): Promise<HoldOutcome> {
    switch (marker.kind) {
      case ModerationHoldActionKind.PLACED:
        return this.replayPlaced(marker);
      case ModerationHoldActionKind.EXTENDED:
        return this.inForce(marker, async (manager, hold) => {
          const from = hold.reviewAt.toISOString();

          await manager.update(
            ModerationHoldEntity,
            { id: hold.id },
            { reviewAt: new Date(marker.reviewAt) },
          );
          await logReplayed(manager, marker, { from, to: marker.reviewAt });
        });
      default:
        return this.inForce(marker, async (manager, hold) => {
          await manager.update(
            ModerationHoldEntity,
            { id: hold.id },
            {
              releasedAt: new Date(marker.createdAt),
              releasedByUserId: null,
              releaseReason: HOLD_REPLAYED_REASON,
            },
          );
          await logReplayed(manager, marker, {});
        });
    }
  }

  /**
   * Makes a hold again, with its own ID.
   *
   * @param marker - Its placing.
   * @returns What was done.
   */
  private async replayPlaced(marker: HoldMarker): Promise<HoldOutcome> {
    const manager = this._dataSource.manager;

    if (
      await manager.exists(ModerationHoldEntity, {
        where: { id: marker.holdId },
      })
    ) {
      return 'alreadyHeld';
    }

    const held =
      marker.holdKind === ModerationHoldKind.CHAT_REPORT
        ? await this.exists(
            manager,
            ChatMessageReportEntity,
            marker.chatReportId,
          )
        : await this.exists(manager, UserEntity, marker.subjectUserId);

    if (!held) {
      return 'nothingToHold';
    }

    const ownerUserId = (await this.exists(
      manager,
      UserEntity,
      marker.ownerUserId,
    ))
      ? marker.ownerUserId
      : null;

    try {
      await this._dataSource.transaction(async transaction => {
        await transaction.insert(ModerationHoldEntity, {
          id: marker.holdId,
          kind: marker.holdKind,
          chatReportId: marker.chatReportId,
          subjectUserId: marker.subjectUserId,
          reason: HOLD_REPLAYED_REASON,
          ownerUserId,
          reviewAt: new Date(marker.reviewAt),
          createdAt: new Date(marker.createdAt),
        });
        await logReplayed(transaction, marker, { reviewAt: marker.reviewAt });
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        return 'alreadyHeld';
      }

      throw error;
    }

    this._logger.warn(
      `[replayPlaced] Moderation hold brought back - HoldId: ${marker.holdId}`,
    );

    return 'replayed';
  }

  /**
   * Changes a hold still in force, locked, and logs the event.
   *
   * @param marker - The event.
   * @param change - What to do to it.
   * @returns What was done.
   */
  private async inForce(
    marker: HoldMarker,
    change: (
      manager: EntityManager,
      hold: ModerationHoldEntity,
    ) => Promise<void>,
  ): Promise<HoldOutcome> {
    return this._dataSource.transaction(async manager => {
      const hold = await manager.findOne(ModerationHoldEntity, {
        where: { id: marker.holdId, releasedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      if (hold === null) {
        return 'notInForce';
      }

      await change(manager, hold);

      return 'replayed';
    });
  }

  /**
   * Whether a row is still there.
   *
   * @param manager - The manager to read through.
   * @param entity - Its table.
   * @param id - Its ID, or null for none.
   * @returns True when it is.
   */
  private async exists(
    manager: EntityManager,
    entity: typeof UserEntity | typeof ChatMessageReportEntity,
    id: string | null,
  ): Promise<boolean> {
    return id !== null && manager.exists(entity, { where: { id } });
  }

  /**
   * Every placing, extension and release in the log, with its hold, read a
   * chunk at a time.
   *
   * @returns Each.
   */
  private async loggedEvents(): Promise<
    Array<{ action: ModerationHoldActionEntity; hold: ModerationHoldEntity }>
  > {
    const manager = this._dataSource.manager;
    const all: Array<{
      action: ModerationHoldActionEntity;
      hold: ModerationHoldEntity;
    }> = [];
    let page: ModerationHoldActionEntity[];

    do {
      const after = all.length === 0 ? null : all[all.length - 1].action.id;

      page = await manager.find(ModerationHoldActionEntity, {
        where: {
          action: In([...LEDGERED_HOLD_ACTIONS]),
          ...(after === null ? {} : { id: MoreThan(after) }),
        },
        select: {
          id: true,
          holdId: true,
          action: true,
          detail: true,
          createdAt: true,
        },
        order: { id: 'ASC' },
        take: LEDGER_CHUNK_SIZE,
      });

      const holds = new Map(
        (page.length === 0
          ? []
          : await manager.find(ModerationHoldEntity, {
              where: { id: In([...new Set(page.map(each => each.holdId))]) },
            })
        ).map(hold => [hold.id, hold]),
      );

      // A log entry always has its hold: the foreign key cascades.
      all.push(
        ...page.map(action => ({ action, hold: holds.get(action.holdId)! })),
      );
    } while (page.length === LEDGER_CHUNK_SIZE);

    return all;
  }
}

/**
 * Logs an event brought back from the ledger, under its own ID and time,
 * with no actor, marked as the system's.
 *
 * @param manager - The transaction.
 * @param marker - The event.
 * @param detail - What changed.
 */
async function logReplayed(
  manager: EntityManager,
  marker: HoldMarker,
  detail: Record<string, unknown>,
): Promise<void> {
  await manager.insert(ModerationHoldActionEntity, {
    id: marker.actionId,
    holdId: marker.holdId,
    action: marker.kind,
    actorUserId: null,
    reason: HOLD_REPLAYED_REASON,
    // Nobody's: the hold's log shows it as the system's, as the automatic
    // release is.
    detail: { ...detail, automatic: true, replayed: true } as never,
    idempotencyKey: null,
    createdAt: new Date(marker.createdAt),
  });
}

/**
 * The review date a logged event left its hold with, as best the log says.
 *
 * @param action - The event.
 * @param hold - Its hold, as it is now.
 * @returns The date, as ISO 8601.
 */
function reviewAtOf(
  action: ModerationHoldActionEntity,
  hold: ModerationHoldEntity,
): string {
  const recorded = action.detail?.to ?? action.detail?.reviewAt;

  return typeof recorded === 'string' ? recorded : hold.reviewAt.toISOString();
}
