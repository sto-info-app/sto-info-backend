import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  QueryRunner,
  RemoveEvent,
  SoftRemoveEvent,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  UpdateEvent,
} from 'typeorm';

import { FriendshipEntity } from 'src/community/entities/friendship.entity';
import { UserBlockEntity } from 'src/community/entities/user-block.entity';
import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';

import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { ChatAccessChange, ChatDeliveryService } from './chat-delivery.service';

/** Any entity event the watcher hears. */
type WatchedEvent =
  | InsertEvent<unknown>
  | UpdateEvent<unknown>
  | RemoveEvent<unknown>
  | SoftRemoveEvent<unknown>;

/** The people a row names, by the columns that name them. */
const PEOPLE_COLUMNS = new Map<unknown, readonly string[]>([
  [ScopeMembershipEntity, ['userId']],
  [ScopeRoleAssignmentEntity, ['userId']],
  [FriendshipEntity, ['requesterId', 'addresseeId']],
  [UserBlockEntity, ['blockerId', 'blockedId']],
  [UserPreferenceEntity, ['userId']],
]);

/**
 * Watches the database for changes to who may read what in chat, and has
 * delivery ask again at once (FC-034).
 *
 * Steve's decision of 29 September 2026: leaving a Fleet, a role ending, a
 * suspension, a Fleet leaving an Armada, unfriending and blocking each take
 * effect on open sockets straight away, on every instance. Rather than every
 * service that makes such a change remembering to say so, the rows they
 * write are watched: memberships, role assignments, Armada placements,
 * friendships, blocks and presence preferences. A change made in a
 * transaction is held until it commits, and dropped if it rolls back, so a
 * socket is never checked against what is about to be undone.
 *
 * A row an update names only by its conditions carries nobody, so such a
 * change has every socket checked again; they are rare.
 */
@Injectable()
export class ChatAccessWatcher
  implements EntitySubscriberInterface, OnModuleDestroy
{
  /** Changes waiting for their transaction to commit. */
  private readonly _pending = new Map<QueryRunner, ChatAccessChange[]>();

  /**
   * Creates an instance of ChatAccessWatcher, and starts watching.
   *
   * @param _dataSource - The database.
   * @param _delivery - Checks sockets again.
   */
  constructor(
    @InjectDataSource()
    private readonly _dataSource: DataSource,
    private readonly _delivery: ChatDeliveryService,
  ) {
    this._dataSource.subscribers.push(this);
  }

  /**
   * Stops watching.
   */
  onModuleDestroy(): void {
    const index = this._dataSource.subscribers.indexOf(this);

    this._dataSource.subscribers.splice(index, 1);
  }

  /**
   * Hears a row written.
   *
   * @param event - The insert.
   */
  afterInsert(event: InsertEvent<unknown>): void {
    this.heard(event, event.entity);
  }

  /**
   * Hears a row changed.
   *
   * @param event - The update.
   */
  afterUpdate(event: UpdateEvent<unknown>): void {
    this.heard(event, event.entity ?? event.databaseEntity);
  }

  /**
   * Hears a row removed.
   *
   * @param event - The removal.
   */
  afterRemove(event: RemoveEvent<unknown>): void {
    this.heard(event, event.entity ?? event.databaseEntity);
  }

  /**
   * Hears a row soft-removed.
   *
   * @param event - The removal.
   */
  afterSoftRemove(event: SoftRemoveEvent<unknown>): void {
    this.heard(event, event.entity ?? event.databaseEntity);
  }

  /**
   * Passes on what a committed transaction changed.
   *
   * @param event - The commit.
   */
  afterTransactionCommit(event: TransactionCommitEvent): void {
    const changes = this._pending.get(event.queryRunner) ?? [];

    this._pending.delete(event.queryRunner);

    for (const change of changes) {
      void this._delivery.revoke(change);
    }
  }

  /**
   * Forgets what a rolled-back transaction would have changed.
   *
   * @param event - The rollback.
   */
  afterTransactionRollback(event: TransactionRollbackEvent): void {
    this._pending.delete(event.queryRunner);
  }

  /**
   * Notes a change to a watched row: now, or when its transaction commits.
   *
   * @param event - The event.
   * @param row - The row, if the event carries one.
   */
  private heard(event: WatchedEvent, row: unknown): void {
    const target = event.metadata.target;
    const columns = PEOPLE_COLUMNS.get(target);

    if (columns === undefined && target !== ArmadaFleetMembershipEntity) {
      return;
    }

    const people =
      columns === undefined || row === undefined || row === null
        ? []
        : columns
            .map(column => (row as Record<string, unknown>)[column])
            .filter((id): id is string => typeof id === 'string');
    const change: ChatAccessChange =
      people.length === 0
        ? { kind: 'everyone' }
        : { kind: 'people', userIds: people };
    const runner = event.queryRunner;

    if (runner.isTransactionActive) {
      this._pending.set(runner, [...(this._pending.get(runner) ?? []), change]);
    } else {
      void this._delivery.revoke(change);
    }
  }
}
