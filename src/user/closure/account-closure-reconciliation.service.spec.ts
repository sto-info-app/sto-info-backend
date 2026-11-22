import { Logger } from '@nestjs/common';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Repository } from 'typeorm';

import { LEDGER_CHUNK_SIZE, LedgerKey } from 'src/shared/ledger/ledger.utility';

import { InMemoryManager, Row } from '../../../test/in-memory-manager';
import { UserEntity } from '../entities/user.entity';
import { UserService } from '../user.service';
import {
  AccountClosureEvent,
  AccountClosureLedgerService,
  AccountClosureMarker,
} from './account-closure-ledger.service';
import { AccountClosureReconciliationService } from './account-closure-reconciliation.service';

/**
 * A user ID that sorts by its number.
 *
 * @param n - The number.
 * @returns The ID.
 */
const userId = (n: number): string =>
  `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('AccountClosureReconciliationService (FC-042)', () => {
  let db: InMemoryManager;
  let keys: LedgerKey[];
  let ledger: {
    listKeys: jest.Mock<() => Promise<LedgerKey[]>>;
    write: jest.Mock<(marker: AccountClosureMarker) => Promise<void>>;
  };
  let users: {
    closeAgain: jest.Mock<(id: string, closedAt: Date) => Promise<void>>;
  };
  let service: AccountClosureReconciliationService;

  /**
   * A closure's, or a reopening's, key.
   *
   * @param n - The user's number.
   * @param event - What.
   * @param createdAt - When.
   * @returns The key.
   */
  const keyOf = (
    n: number,
    event: AccountClosureEvent,
    createdAt = '2026-09-20T12:00:00.000Z',
  ): LedgerKey => ({
    key: `test/account-closure-ledger/${createdAt}_${userId(n)}_${event}.json`,
    createdAt,
    id: userId(n),
    kind: event,
  });

  /**
   * A user, open or closed.
   *
   * @param n - Their number.
   * @param deletedAt - When they closed it, or null.
   * @returns The row.
   */
  const user = (n: number, deletedAt: Date | null = null): Row => ({
    id: userId(n),
    deletedAt,
  });

  beforeEach(() => {
    db = new InMemoryManager();
    keys = [];
    ledger = {
      listKeys: jest.fn(async () => keys),
      write: jest.fn(async () => undefined),
    };
    users = { closeAgain: jest.fn(async () => undefined) };
    // As TypeORM does, a find leaves out the closed unless asked not to.
    const find = (options: { where: Row; withDeleted?: boolean }) =>
      db
        .find(UserEntity, options)
        .then(rows =>
          options.withDeleted ? rows : rows.filter(row => !row.deletedAt),
        );

    service = new AccountClosureReconciliationService(
      { find } as unknown as Repository<UserEntity>,
      ledger as unknown as AccountClosureLedgerService,
      users as unknown as UserService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes again, as of when it was closed, an account a restore opened', async () => {
    db.seed(UserEntity, [user(1)]);
    keys = [keyOf(1, AccountClosureEvent.CLOSED)];

    await expect(service.reconcile()).resolves.toEqual({
      markers: 1,
      replayed: 1,
      backfilled: 0,
      detail: { gone: 0, reopened: 0 },
      timings: {
        list: expect.any(Number),
        compare: expect.any(Number),
        replay: expect.any(Number),
        backfill: expect.any(Number),
      },
    });
    expect(users.closeAgain).toHaveBeenCalledWith(
      userId(1),
      new Date('2026-09-20T12:00:00.000Z'),
    );
  });

  it('leaves an account already closed, and counts one the database no longer has', async () => {
    db.seed(UserEntity, [user(1, new Date('2026-09-20T12:00:00.000Z'))]);
    keys = [
      keyOf(1, AccountClosureEvent.CLOSED),
      keyOf(2, AccountClosureEvent.CLOSED),
    ];

    await expect(service.reconcile()).resolves.toMatchObject({
      markers: 2,
      replayed: 0,
      backfilled: 0,
      detail: { gone: 1 },
    });
    expect(users.closeAgain).not.toHaveBeenCalled();
  });

  it('follows each account’s latest marker, leaving one opened again as the database has it', async () => {
    db.seed(UserEntity, [user(1), user(2)]);
    keys = [
      keyOf(1, AccountClosureEvent.CLOSED, '2026-09-10T12:00:00.000Z'),
      keyOf(2, AccountClosureEvent.REOPENED, '2026-09-11T12:00:00.000Z'),
      keyOf(1, AccountClosureEvent.REOPENED, '2026-09-12T12:00:00.000Z'),
      keyOf(2, AccountClosureEvent.CLOSED, '2026-09-13T12:00:00.000Z'),
    ];

    await expect(service.reconcile()).resolves.toMatchObject({
      replayed: 1,
      detail: { reopened: 1 },
    });
    expect(users.closeAgain.mock.calls).toEqual([
      [userId(2), new Date('2026-09-13T12:00:00.000Z')],
    ]);
  });

  it('passes a failure on, for the check to try again', async () => {
    db.seed(UserEntity, [user(1)]);
    keys = [keyOf(1, AccountClosureEvent.CLOSED)];
    users.closeAgain.mockRejectedValue(new Error('Database gone'));

    await expect(service.reconcile()).rejects.toThrow('Database gone');
  });

  it('writes a marker for every closed account it lacks, a chunk of the database at a time', async () => {
    db.seed(
      UserEntity,
      Array.from({ length: LEDGER_CHUNK_SIZE + 1 }, (_, n) =>
        user(n + 1, new Date(Date.UTC(2026, 8, 1, 0, 0, n))),
      ),
    );
    db.seed(UserEntity, [user(LEDGER_CHUNK_SIZE + 2)]);
    keys = [keyOf(1, AccountClosureEvent.CLOSED)];

    await expect(service.reconcile()).resolves.toMatchObject({
      replayed: 0,
      backfilled: LEDGER_CHUNK_SIZE,
    });
    expect(ledger.write).toHaveBeenCalledWith({
      userId: userId(2),
      event: AccountClosureEvent.CLOSED,
      createdAt: '2026-09-01T00:00:01.000Z',
    });
  });

  it('asks after many markers’ accounts a chunk at a time', async () => {
    keys = Array.from({ length: LEDGER_CHUNK_SIZE + 1 }, (_, n) =>
      keyOf(n + 1, AccountClosureEvent.CLOSED),
    );

    await expect(service.reconcile()).resolves.toMatchObject({
      markers: LEDGER_CHUNK_SIZE + 1,
      detail: { gone: LEDGER_CHUNK_SIZE + 1 },
    });
  });
});
