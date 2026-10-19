import { Injectable, Logger } from '@nestjs/common';

import { DataSource, In } from 'typeorm';

import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { StoRecordDeletion } from 'src/sto/shared/sto-record-deletion';

import {
  CustomTrackingFieldPictureService,
  CustomTrackingRecords,
} from './custom-tracking-field-picture.service';

/**
 * Takes down the Custom Tracking pictures describing a deleted STO Account or
 * Character.
 *
 * A deleted Account or Character can no longer be reached, by its owner or by
 * the public, so its answers are already out of sight; the retention purge
 * removes them 180 days after the record was deleted. Its pictures are
 * published, though, so they go at once: each picture's answer is removed and
 * the picture is withdrawn through the registry, as deleting a Field does.
 *
 * Called after the record's deletion has happened, so nothing here may undo
 * it. A failure is logged, and the sweep at the next start finds whatever
 * picture is left.
 */
@Injectable()
export class CustomTrackingRecordDeletionService implements StoRecordDeletion {
  private readonly _logger = new Logger(
    CustomTrackingRecordDeletionService.name,
  );

  /**
   * Creates an instance of CustomTrackingRecordDeletionService.
   *
   * @param _dataSource - Opens the transaction the answers go in.
   * @param _pictures - Removes the answers and withdraws the pictures.
   */
  constructor(
    private readonly _dataSource: DataSource,
    private readonly _pictures: CustomTrackingFieldPictureService,
  ) {}

  /**
   * Takes down the pictures describing deleted Characters.
   *
   * @param characterIds - The Characters.
   * @param reason - Why, as the registry records it.
   */
  async charactersDeleted(
    characterIds: string[],
    reason: string,
  ): Promise<void> {
    await this.recordsDeleted({ accountIds: [], characterIds }, reason);
  }

  /**
   * Takes down the pictures describing deleted Accounts and their Characters.
   *
   * @param accountIds - The Accounts.
   * @param reason - Why, as the registry records it.
   */
  async accountsDeleted(accountIds: string[], reason: string): Promise<void> {
    if (accountIds.length === 0) {
      return;
    }

    try {
      const characters = await this._dataSource.manager.find(CharacterEntity, {
        where: { accountId: In(accountIds) },
        withDeleted: true,
        select: { id: true },
      });

      await this.recordsDeleted(
        {
          accountIds,
          characterIds: characters.map(character => character.id),
        },
        reason,
      );
    } catch (error: unknown) {
      this.logFailure(error);
    }
  }

  /**
   * Removes the records' picture answers, then withdraws the pictures.
   *
   * @param records - The Accounts and Characters deleted.
   * @param reason - Why, as the registry records it.
   */
  private async recordsDeleted(
    records: CustomTrackingRecords,
    reason: string,
  ): Promise<void> {
    try {
      const pictures = await this._dataSource.transaction(manager =>
        this._pictures.detachForRecords(manager, records, reason),
      );

      await this._pictures.withdrawEach(pictures);
    } catch (error: unknown) {
      this.logFailure(error);
    }
  }

  /**
   * Logs pictures that were not taken down, for the sweep to find.
   *
   * @param error - What went wrong.
   */
  private logFailure(error: unknown): void {
    this._logger.error(
      '[recordsDeleted] Custom Tracking pictures not taken down',
      error instanceof Error ? error.stack : String(error),
    );
  }
}
