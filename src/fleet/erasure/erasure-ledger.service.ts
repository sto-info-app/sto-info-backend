import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { LedgerStore } from 'src/shared/ledger/ledger-store';
import { LedgerKey } from 'src/shared/ledger/ledger.utility';

import { ERASURE_LEDGER_PREFIX } from './roster-erasure.constants';

/** What the ledger keeps of one erasure: nothing that names anybody. */
export interface ErasureMarker {
  readonly id: string;
  readonly pairHash: string;
  readonly pseudonym: string;
  /** When it was made, as ISO 8601. */
  readonly createdAt: string;
}

/**
 * Keeps every roster erasure's marker outside the database (FC-038).
 *
 * Steve's decision of 29 September 2026: a restore from a backup taken
 * before an erasure would bring back what it erased. Each marker is also
 * written, one object per erasure, to the private quarantine bucket, which
 * has no expiry rule, under `<NODE_ENV>/erasure-ledger/<createdAt>_<id>.json`.
 * At every boot, before the API serves anything, the restore check (FC-042)
 * compares the keys with the database and re-applies every marker the
 * database no longer has; it reads only those markers' bodies. A marker
 * holds the keyed hash and the pseudonym, never the name, the handle or the
 * reason.
 */
@Injectable()
export class ErasureLedgerService {
  private readonly _store: LedgerStore<ErasureMarker>;

  /**
   * Creates an instance of ErasureLedgerService.
   *
   * @param storage - The private bucket.
   * @param config - Names the environment the keys are under.
   */
  constructor(storage: QuarantineStorageService, config: ConfigService) {
    this._store = new LedgerStore(
      storage,
      config.get<string>('NODE_ENV')!,
      ERASURE_LEDGER_PREFIX,
      null,
    );
  }

  /**
   * Writes a marker.
   *
   * @param marker - The marker.
   */
  async write(marker: ErasureMarker): Promise<void> {
    await this._store.write(marker.createdAt, marker.id, undefined, marker);
  }

  /**
   * Lists every marker's key, oldest first, without reading a body.
   *
   * @returns What each key says.
   */
  listKeys(): Promise<LedgerKey[]> {
    return this._store.listKeys();
  }

  /**
   * Reads one marker.
   *
   * @param key - Its key.
   * @returns It.
   */
  read(key: string): Promise<ErasureMarker> {
    return this._store.read(key);
  }
}
