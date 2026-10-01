import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { LedgerStore } from 'src/shared/ledger/ledger-store';
import { LedgerKey } from 'src/shared/ledger/ledger.utility';

/** Where each account closure's marker is kept outside the database. */
export const ACCOUNT_CLOSURE_LEDGER_PREFIX = 'account-closure-ledger';

/** What happened to an account, as the closure ledger records it. */
export enum AccountClosureEvent {
  /** The account was closed. */
  CLOSED = 'CLOSED',
  /**
   * A closed account was opened again. Only the local seed user ever is, by
   * the seeder outside production; the restore check never replays it.
   */
  REOPENED = 'REOPENED',
}

/**
 * What the ledger keeps of one closure: the account's ID, what and when.
 * No name, email or reason.
 */
export interface AccountClosureMarker {
  readonly userId: string;
  readonly event: AccountClosureEvent;
  /** When, as ISO 8601. */
  readonly createdAt: string;
}

/**
 * Keeps every account closure outside the database (FC-042).
 *
 * Steve's decision of 30 September 2026: a restore from a backup taken
 * before somebody closed their account would open it again, and nothing
 * else records that they asked. Each closure is written here first — one
 * object per event, in the private quarantine bucket, under
 * `<NODE_ENV>/account-closure-ledger/<createdAt>_<userId>_CLOSED.json` —
 * and then to the database, and the restore check at boot closes again any
 * account the database has open. The key holds everything the check needs,
 * so it reads no body.
 */
@Injectable()
export class AccountClosureLedgerService {
  private readonly _store: LedgerStore<AccountClosureMarker>;

  /**
   * Creates an instance of AccountClosureLedgerService.
   *
   * @param storage - The private bucket.
   * @param config - Names the environment the keys are under.
   */
  constructor(storage: QuarantineStorageService, config: ConfigService) {
    this._store = new LedgerStore(
      storage,
      config.get<string>('NODE_ENV')!,
      ACCOUNT_CLOSURE_LEDGER_PREFIX,
      Object.values(AccountClosureEvent),
    );
  }

  /**
   * Records something happening to an account, before the database does.
   *
   * @param userId - The account.
   * @param event - What.
   * @returns When, as recorded.
   */
  async record(userId: string, event: AccountClosureEvent): Promise<Date> {
    const at = new Date();

    await this.write({ userId, event, createdAt: at.toISOString() });

    return at;
  }

  /**
   * Writes a marker.
   *
   * @param marker - The marker.
   */
  async write(marker: AccountClosureMarker): Promise<void> {
    await this._store.write(
      marker.createdAt,
      marker.userId,
      marker.event,
      marker,
    );
  }

  /**
   * Lists every marker's key, oldest first, without reading a body.
   *
   * @returns What each key says.
   */
  listKeys(): Promise<LedgerKey[]> {
    return this._store.listKeys();
  }
}
