import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  DataSource,
  InsertEvent,
  QueryRunner,
  RemoveEvent,
  SoftRemoveEvent,
  TransactionCommitEvent,
  UpdateEvent,
} from 'typeorm';

import { FriendshipEntity } from 'src/community/entities/friendship.entity';
import { UserBlockEntity } from 'src/community/entities/user-block.entity';
import { UserPreferenceEntity } from 'src/user/entities/user-preference.entity';

import { ArmadaFleetMembershipEntity } from '../../entities/armada-fleet-membership.entity';
import { ScopeMembershipEntity } from '../../entities/scope-membership.entity';
import { ScopeRoleAssignmentEntity } from '../../entities/scope-role-assignment.entity';
import { ChatMessageEntity } from '../entities/chat-message.entity';
import { ChatAccessWatcher } from './chat-access-watcher';
import { ChatDeliveryService } from './chat-delivery.service';

/**
 * A query runner, in a transaction or not.
 *
 * @param isTransactionActive - Whether it is.
 * @returns The runner.
 */
const runnerOf = (isTransactionActive: boolean): QueryRunner =>
  ({ isTransactionActive }) as QueryRunner;

/**
 * An entity event.
 *
 * @param target - The entity class.
 * @param entity - The row, if the event carries one.
 * @param queryRunner - Its runner.
 * @returns The event.
 */
function eventOf<T>(
  target: unknown,
  entity: unknown,
  queryRunner = runnerOf(false),
): T {
  return { metadata: { target }, entity, queryRunner } as T;
}

describe('ChatAccessWatcher', () => {
  let subscribers: unknown[];
  let delivery: { revoke: jest.Mock };
  let watcher: ChatAccessWatcher;

  beforeEach(() => {
    subscribers = [];
    delivery = { revoke: jest.fn(async () => undefined) };
    watcher = new ChatAccessWatcher(
      { subscribers } as unknown as DataSource,
      delivery as unknown as ChatDeliveryService,
    );
  });

  it('watches from the start, and stops with the module', () => {
    expect(subscribers).toEqual([watcher]);

    watcher.onModuleDestroy();

    expect(subscribers).toEqual([]);
  });

  it.each([
    [ScopeMembershipEntity, { userId: 'member' }, ['member']],
    [ScopeRoleAssignmentEntity, { userId: 'officer' }, ['officer']],
    [FriendshipEntity, { requesterId: 'a', addresseeId: 'b' }, ['a', 'b']],
    [UserBlockEntity, { blockerId: 'a', blockedId: 'b' }, ['a', 'b']],
    [UserPreferenceEntity, { userId: 'member' }, ['member']],
  ])('checks again the people a %p row names', (target, row, userIds) => {
    watcher.afterInsert(eventOf<InsertEvent<unknown>>(target, row));

    expect(delivery.revoke).toHaveBeenCalledWith({ kind: 'people', userIds });
  });

  it('checks everybody again when an Armada placement changes', () => {
    watcher.afterUpdate(
      eventOf<UpdateEvent<unknown>>(ArmadaFleetMembershipEntity, {
        fleetId: 'fleet',
      }),
    );

    expect(delivery.revoke).toHaveBeenCalledWith({ kind: 'everyone' });
  });

  it('checks everybody again when a change names nobody', () => {
    watcher.afterUpdate(
      eventOf<UpdateEvent<unknown>>(ScopeMembershipEntity, undefined),
    );
    watcher.afterRemove(eventOf<RemoveEvent<unknown>>(FriendshipEntity, null));

    expect(delivery.revoke).toHaveBeenNthCalledWith(1, { kind: 'everyone' });
    expect(delivery.revoke).toHaveBeenNthCalledWith(2, { kind: 'everyone' });
  });

  it('reads the row as it was when a change carries only that', () => {
    watcher.afterRemove({
      ...eventOf<RemoveEvent<unknown>>(UserBlockEntity, undefined),
      databaseEntity: { blockerId: 'a', blockedId: 'b' },
    });
    watcher.afterSoftRemove({
      ...eventOf<SoftRemoveEvent<unknown>>(ScopeMembershipEntity, undefined),
      databaseEntity: { userId: 'member' },
    });
    watcher.afterSoftRemove(
      eventOf<SoftRemoveEvent<unknown>>(FriendshipEntity, {
        requesterId: 'a',
        addresseeId: 'b',
      }),
    );

    expect(delivery.revoke.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'people', userIds: ['a', 'b'] },
      { kind: 'people', userIds: ['member'] },
      { kind: 'people', userIds: ['a', 'b'] },
    ]);
  });

  it('ignores anything else', () => {
    watcher.afterInsert(
      eventOf<InsertEvent<unknown>>(ChatMessageEntity, { id: 'm' }),
    );

    expect(delivery.revoke).not.toHaveBeenCalled();
  });

  it('holds a change made in a transaction until it commits', () => {
    const runner = runnerOf(true);

    watcher.afterInsert(
      eventOf<InsertEvent<unknown>>(
        ScopeMembershipEntity,
        { userId: 'a' },
        runner,
      ),
    );
    watcher.afterInsert(
      eventOf<InsertEvent<unknown>>(
        ScopeMembershipEntity,
        { userId: 'b' },
        runner,
      ),
    );
    expect(delivery.revoke).not.toHaveBeenCalled();

    watcher.afterTransactionCommit({
      queryRunner: runner,
    } as TransactionCommitEvent);
    watcher.afterTransactionCommit({
      queryRunner: runner,
    } as TransactionCommitEvent);

    expect(delivery.revoke.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'people', userIds: ['a'] },
      { kind: 'people', userIds: ['b'] },
    ]);
  });

  it('forgets a change whose transaction rolls back', () => {
    const runner = runnerOf(true);

    watcher.afterInsert(
      eventOf<InsertEvent<unknown>>(
        ScopeMembershipEntity,
        { userId: 'a' },
        runner,
      ),
    );
    watcher.afterTransactionRollback({ queryRunner: runner } as never);
    watcher.afterTransactionCommit({
      queryRunner: runner,
    } as TransactionCommitEvent);

    expect(delivery.revoke).not.toHaveBeenCalled();
  });
});
