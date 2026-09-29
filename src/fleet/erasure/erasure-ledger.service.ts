import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';

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
 * has no expiry rule; after a restore, a site admin's "Replay the erasure
 * ledger" (`POST /admin/roster-erasures/replay-ledger`) re-applies every
 * marker the database no longer has. A marker holds the keyed hash
 * and the pseudonym, never the name, the handle or the reason.
 */
@Injectable()
export class ErasureLedgerService {
  /**
   * Creates an instance of ErasureLedgerService.
   *
   * @param _storage - The private bucket.
   * @param _config - Names the environment the keys are under.
   */
  constructor(
    private readonly _storage: QuarantineStorageService,
    private readonly _config: ConfigService,
  ) {}

  /**
   * Writes a marker.
   *
   * @param marker - The marker.
   */
  async write(marker: ErasureMarker): Promise<void> {
    await this._storage.put(
      `${this.prefix()}${marker.createdAt}_${marker.id}.json`,
      Buffer.from(JSON.stringify(marker)),
    );
  }

  /**
   * Reads every marker, oldest first.
   *
   * @returns Each.
   */
  async list(): Promise<ErasureMarker[]> {
    const keys = (await this._storage.listKeys(this.prefix())).sort();
    const markers: ErasureMarker[] = [];

    for (const key of keys) {
      markers.push(
        JSON.parse(
          (await this._storage.read(key, null)).toString('utf8'),
        ) as ErasureMarker,
      );
    }

    return markers;
  }

  /**
   * Where this environment's markers are.
   *
   * @returns The prefix.
   */
  private prefix(): string {
    return `${this._config.get<string>('NODE_ENV')}/${ERASURE_LEDGER_PREFIX}/`;
  }
}
