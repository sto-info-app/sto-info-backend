import { Logger } from '@nestjs/common';

import { LedgerKey, ledgerKey, parseLedgerKey } from './ledger.utility';

/** What a ledger needs of the private bucket it is kept in. */
export interface LedgerStorage {
  put(objectKey: string, body: Buffer): Promise<unknown>;
  listKeys(prefix: string): Promise<string[]>;
  read(objectKey: string, objectVersion: null): Promise<Buffer>;
}

/**
 * One ledger kept outside the database (FC-038, FC-042): one JSON object per
 * marker under `<NODE_ENV>/<name>/`, keyed by when, what about and, for a
 * ledger that records more than one thing, what, so the restore check can
 * compare it with the database from a listing alone.
 */
export class LedgerStore<M> {
  private readonly _logger: Logger;
  private readonly _prefix: string;

  /**
   * Creates a ledger.
   *
   * @param _storage - The private bucket.
   * @param environment - The environment the keys are under.
   * @param name - The ledger's folder.
   * @param _kinds - What its keys may record, or null for a ledger of one
   *   thing, whose keys record nothing.
   */
  constructor(
    private readonly _storage: LedgerStorage,
    environment: string,
    name: string,
    private readonly _kinds: readonly string[] | null,
  ) {
    this._prefix = `${environment}/${name}/`;
    this._logger = new Logger(`LedgerStore:${name}`);
  }

  /**
   * Writes a marker, or writes it again.
   *
   * @param createdAt - When, as ISO 8601.
   * @param id - What about.
   * @param kind - What, for a ledger of more than one thing.
   * @param marker - The body.
   */
  async write(
    createdAt: string,
    id: string,
    kind: string | undefined,
    marker: M,
  ): Promise<void> {
    await this._storage.put(
      ledgerKey(this._prefix, createdAt, id, kind),
      Buffer.from(JSON.stringify(marker)),
    );
  }

  /**
   * Lists every marker's key, oldest first, without reading a body. A key
   * the ledger did not write is left out, with a warning.
   *
   * @returns What each key says.
   */
  async listKeys(): Promise<LedgerKey[]> {
    const keys: LedgerKey[] = [];

    for (const key of (await this._storage.listKeys(this._prefix)).sort()) {
      const parsed = parseLedgerKey(this._prefix, key);

      if (parsed === null || !this.recordsKind(parsed.kind)) {
        this._logger.warn(
          `[listKeys] Not a marker of this ledger - Key: ${key}`,
        );
        continue;
      }

      keys.push(parsed);
    }

    return keys;
  }

  /**
   * Reads one marker.
   *
   * @param key - Its key.
   * @returns It.
   */
  async read(key: string): Promise<M> {
    return JSON.parse(
      (await this._storage.read(key, null)).toString('utf8'),
    ) as M;
  }

  /**
   * Whether a key's kind is one this ledger records.
   *
   * @param kind - The kind, or null.
   * @returns True when it is.
   */
  private recordsKind(kind: string | null): boolean {
    return this._kinds === null
      ? kind === null
      : kind !== null && this._kinds.includes(kind);
  }
}
