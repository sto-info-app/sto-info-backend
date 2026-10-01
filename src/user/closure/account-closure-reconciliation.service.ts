import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import {
  chunksOf,
  eachLimited,
  LEDGER_CHUNK_SIZE,
  LEDGER_CONCURRENCY,
  LedgerKey,
  LedgerReconciliation,
  noTimings,
  timed,
} from 'src/shared/ledger/ledger.utility';

import { UserEntity } from '../entities/user.entity';
import { UserService } from '../user.service';
import {
  AccountClosureEvent,
  AccountClosureLedgerService,
} from './account-closure-ledger.service';

/**
 * Checks the account-closure ledger against the database, at boot (FC-042).
 *
 * The ledger is read by its keys alone, and the database a chunk at a time.
 * Each account whose latest marker says it was closed, and which the
 * database has open, is closed again the way its owner closed it — as of
 * when they did, so the nightly clean-up erases it when it would have. An
 * account the database does not have at all (erased since, or made after
 * the backup) has nothing left to close. An account whose latest marker says
 * it was opened again is left as the database has it: only the local seed
 * user is ever reopened, and the check never replays that.
 *
 * Every closed account with no marker gets one, so the ledger is complete
 * after the first boot that runs this.
 */
@Injectable()
export class AccountClosureReconciliationService {
  private readonly _logger = new Logger(
    AccountClosureReconciliationService.name,
  );

  /**
   * Creates an instance of AccountClosureReconciliationService.
   *
   * @param _users - Repository of users.
   * @param _ledger - The account-closure ledger.
   * @param _userService - Closes an account again.
   */
  constructor(
    @InjectRepository(UserEntity)
    private readonly _users: Repository<UserEntity>,
    private readonly _ledger: AccountClosureLedgerService,
    private readonly _userService: UserService,
  ) {}

  /**
   * Compares the ledger with the database, closes again every account the
   * database has open and writes a marker for every closure the ledger
   * lacks.
   *
   * @returns What the check came to.
   */
  async reconcile(): Promise<LedgerReconciliation> {
    const timings = noTimings();
    const keys = await timed(timings, 'list', () => this._ledger.listKeys());
    // Oldest first, so each account's latest marker is the one that stays.
    const latest = new Map(keys.map(key => [key.id, key]));
    const reopened = [...latest.values()].filter(
      key => key.kind === AccountClosureEvent.REOPENED,
    ).length;
    const { lacking, unmarked } = await timed(timings, 'compare', async () => {
      const closed = await this.closedAccounts();
      const closedIds = new Set(closed.map(user => user.id));
      const candidates = [...latest.values()].filter(
        key =>
          key.kind === AccountClosureEvent.CLOSED && !closedIds.has(key.id),
      );
      const open = await this.openAccounts(candidates.map(key => key.id));

      return {
        lacking: candidates.map(key => ({ key, open: open.has(key.id) })),
        unmarked: closed.filter(user => !latest.has(user.id)),
      };
    });
    let gone = 0;
    const replayed = await timed(timings, 'replay', async () => {
      let closedAgain = 0;

      for (const { key, open } of lacking) {
        if (!open) {
          gone++;
          continue;
        }

        await this.closeAgain(key);
        closedAgain++;
      }

      return closedAgain;
    });
    const backfilled = await timed(timings, 'backfill', async () => {
      await eachLimited(unmarked, LEDGER_CONCURRENCY, user =>
        this._ledger.write({
          userId: user.id,
          event: AccountClosureEvent.CLOSED,
          createdAt: (user.deletedAt as Date).toISOString(),
        }),
      );

      return unmarked.length;
    });

    this._logger.log(
      `[reconcile] Account-closure ledger checked - Markers: ${keys.length}, ` +
        `ClosedAgain: ${replayed}, Gone: ${gone}, Reopened: ${reopened}, ` +
        `Backfilled: ${backfilled}`,
    );

    return {
      markers: keys.length,
      replayed,
      backfilled,
      detail: { gone, reopened },
      timings,
    };
  }

  /**
   * Closes an account again, as of its marker.
   *
   * @param key - Its latest marker's key.
   */
  private async closeAgain(key: LedgerKey): Promise<void> {
    await this._userService.closeAgain(key.id, new Date(key.createdAt));
    this._logger.warn(
      `[closeAgain] Account closed again from the ledger - UserId: ${key.id}`,
    );
  }

  /**
   * Every closed account, read a chunk at a time.
   *
   * @returns Each, with when it was closed.
   */
  private async closedAccounts(): Promise<UserEntity[]> {
    const all: UserEntity[] = [];
    let page: UserEntity[];

    do {
      const after = all.length === 0 ? null : all[all.length - 1].id;

      page = await this._users.find({
        where: {
          deletedAt: Not(IsNull()),
          ...(after === null ? {} : { id: MoreThan(after) }),
        },
        withDeleted: true,
        select: { id: true, deletedAt: true },
        order: { id: 'ASC' },
        take: LEDGER_CHUNK_SIZE,
      });
      all.push(...page);
    } while (page.length === LEDGER_CHUNK_SIZE);

    return all;
  }

  /**
   * Which of some accounts the database has open, read a chunk at a time.
   *
   * @param ids - The accounts.
   * @returns The open ones.
   */
  private async openAccounts(ids: readonly string[]): Promise<Set<string>> {
    const open = new Set<string>();

    for (const chunk of chunksOf(ids, LEDGER_CHUNK_SIZE)) {
      for (const user of await this._users.find({
        where: { id: In(chunk) },
        select: { id: true },
      })) {
        open.add(user.id);
      }
    }

    return open;
  }
}
