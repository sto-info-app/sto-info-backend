import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { LedgerStore } from 'src/shared/ledger/ledger-store';
import { LedgerKey } from 'src/shared/ledger/ledger.utility';

import {
  ModerationHoldActionKind,
  ModerationHoldKind,
} from './moderation-hold.enums';

/** Where each hold event's marker is kept outside the database. */
export const HOLD_LEDGER_PREFIX = 'hold-ledger';

/** The hold events the ledger keeps: those that change what is held. */
export const LEDGERED_HOLD_ACTIONS: readonly ModerationHoldActionKind[] = [
  ModerationHoldActionKind.PLACED,
  ModerationHoldActionKind.EXTENDED,
  ModerationHoldActionKind.RELEASED,
];

/**
 * What the ledger keeps of one hold event: IDs, dates and the event, and no
 * reason — Steve's decision of 30 September 2026. The action's ID is the
 * log row's own.
 */
export interface HoldMarker {
  readonly actionId: string;
  readonly holdId: string;
  /** The event. */
  readonly kind: ModerationHoldActionKind;
  /** What the hold keeps. */
  readonly holdKind: ModerationHoldKind;
  readonly chatReportId: string | null;
  readonly subjectUserId: string | null;
  readonly ownerUserId: string | null;
  /** Its review date after the event, as ISO 8601. */
  readonly reviewAt: string;
  /** When, as ISO 8601. */
  readonly createdAt: string;
}

/**
 * Keeps every moderation hold's placing, extension and release outside the
 * database (FC-042).
 *
 * Steve's decision of 30 September 2026: a restore from a backup taken
 * before a hold was placed would let the purge take what it keeps, and one
 * taken before a release would keep what should go. Each event is written
 * here first — one object per event, in the private quarantine bucket,
 * under `<NODE_ENV>/hold-ledger/<createdAt>_<actionId>_<KIND>.json` — and
 * then to the database, and the restore check at boot brings back every
 * event the database lacks. A marker whose database write then failed is
 * brought back at the next boot, which errs towards keeping evidence.
 */
@Injectable()
export class HoldLedgerService {
  private readonly _store: LedgerStore<HoldMarker>;

  /**
   * Creates an instance of HoldLedgerService.
   *
   * @param storage - The private bucket.
   * @param config - Names the environment the keys are under.
   */
  constructor(storage: QuarantineStorageService, config: ConfigService) {
    this._store = new LedgerStore(
      storage,
      config.get<string>('NODE_ENV')!,
      HOLD_LEDGER_PREFIX,
      LEDGERED_HOLD_ACTIONS,
    );
  }

  /**
   * Writes a marker.
   *
   * @param marker - The marker.
   */
  async write(marker: HoldMarker): Promise<void> {
    await this._store.write(
      marker.createdAt,
      marker.actionId,
      marker.kind,
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
  read(key: string): Promise<HoldMarker> {
    return this._store.read(key);
  }
}
