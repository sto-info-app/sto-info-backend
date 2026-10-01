import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LedgerStore } from 'src/shared/ledger/ledger-store';
import { LedgerKey } from 'src/shared/ledger/ledger.utility';

import { FileAssetEntity } from '../entities/file-asset.entity';
import { FileAssetState } from '../enums/file-asset-state.enum';
import { FileAssetStorage } from '../enums/file-asset-storage.enum';
import { QuarantineStorageService } from '../services/quarantine-storage.service';

/** Where each asset deny's marker is kept outside the database. */
export const ASSET_DENY_LEDGER_PREFIX = 'asset-deny-ledger';

/** The states an asset is denied in: nothing is served from any of them. */
export const DENIED_FILE_ASSET_STATES: readonly FileAssetState[] = [
  FileAssetState.REJECTED,
  FileAssetState.REVOKED,
  FileAssetState.DELETED,
];

/**
 * What the ledger keeps of one asset moving into a denied state: which, how
 * it was delivered and when. No reason, no name and no owner.
 */
export interface AssetDenyMarker {
  readonly assetId: string;
  /** The denied state it moved into. */
  readonly state: FileAssetState;
  /** How the delivery route addressed it, if it was delivered. */
  readonly deliveryReference: string | null;
  /** Where it was delivered from, before the move. */
  readonly storage: FileAssetStorage;
  /** When, as ISO 8601. */
  readonly createdAt: string;
  /**
   * When the restore check deleted the delivered object of an asset the
   * database does not have, so a later boot need not delete it again.
   */
  readonly purgedAt?: string;
}

/**
 * Keeps every asset deny outside the database (FC-042).
 *
 * Steve's decision of 30 September 2026: a restore from a backup taken
 * before a withdrawal, a rescan infection or a policy take-down would put
 * the picture back. Every move of a `file_asset` into `REJECTED`, `REVOKED`
 * or `DELETED` goes through {@link FileAssetService}, which writes a marker
 * here first — one object per move, in the private quarantine bucket, under
 * `<NODE_ENV>/asset-deny-ledger/<createdAt>_<assetId>_<STATE>.json` — and
 * then writes the database. A marker whose database write then failed is
 * denied again at the next boot: the ledger fails closed.
 */
@Injectable()
export class AssetDenyLedgerService {
  private readonly _store: LedgerStore<AssetDenyMarker>;

  /**
   * Creates an instance of AssetDenyLedgerService.
   *
   * @param storage - The private bucket.
   * @param config - Names the environment the keys are under.
   */
  constructor(storage: QuarantineStorageService, config: ConfigService) {
    this._store = new LedgerStore(
      storage,
      config.get<string>('NODE_ENV')!,
      ASSET_DENY_LEDGER_PREFIX,
      DENIED_FILE_ASSET_STATES,
    );
  }

  /**
   * Records an asset moving into a denied state, before the database does.
   *
   * @param asset - The asset, as it was before the move.
   * @param state - The denied state it is moving into.
   */
  async record(asset: FileAssetEntity, state: FileAssetState): Promise<void> {
    await this.write({
      assetId: asset.id,
      state,
      deliveryReference: asset.deliveryReference,
      storage: asset.storage,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Writes a marker, or writes it again.
   *
   * @param marker - The marker.
   */
  async write(marker: AssetDenyMarker): Promise<void> {
    await this._store.write(
      marker.createdAt,
      marker.assetId,
      marker.state,
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

  /**
   * Reads one marker.
   *
   * @param key - Its key.
   * @returns It.
   */
  read(key: string): Promise<AssetDenyMarker> {
    return this._store.read(key);
  }
}
