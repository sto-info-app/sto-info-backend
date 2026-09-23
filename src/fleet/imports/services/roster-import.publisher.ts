import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetPublisherRegistry,
  RestrictedAssetAttachment,
  RestrictedAssetPublisher,
  RestrictedAssetReceipt,
} from 'src/file-assets/services/asset-publisher.registry';

import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterObservationEntity } from '../entities/roster-observation.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterHoldReason } from '../enums/roster-hold-reason.enum';
import { RosterPublicationRejectionCode } from '../enums/roster-publication-rejection-code.enum';
import {
  normaliseRosterAccountHandle,
  normaliseRosterCharacterName,
} from '../utilities/roster-identity.utility';
import { RosterImportConflictService } from './roster-import-conflict.service';
import {
  RosterDate,
  RosterObservationRow,
  RosterTypedParserService,
} from './roster-typed-parser.service';

/**
 * How many observations go into one INSERT.
 *
 * An export is capped at two thousand rows and an observation has two dozen
 * columns, which in one statement would come within sight of PostgreSQL's
 * limit on bound parameters. Batches keep every statement comfortably inside
 * it without the whole import leaving its transaction.
 */
const OBSERVATION_INSERT_BATCH = 500;

/**
 * Reads a cleared roster export into observations.
 *
 * The roster half of publication. By the time this is called the scanner has
 * cleared the sanitised file, the publication service has checked that the
 * bytes in quarantine are the ones it cleared, and the import's placement is
 * still pending — so nothing this writes is in force yet. Whether an import
 * counts is its placement's state, and every read of a Fleet's roster history
 * starts from the imports whose placement is active.
 *
 * ## The file is read again, not trusted
 *
 * The upload already refused a file whose rows do not read, and this reads it
 * again through the same reader and the zone the upload recorded. The two
 * readings agree unless the reader changed in between; when they do not, the
 * import is refused rather than published on the strength of a check made by
 * code that no longer exists, and the problems are recorded on the import so
 * the uploader can be told why a file that passed an hour ago did not.
 *
 * ## It can be called twice
 *
 * A publication job that fails after this returns is retried from the
 * beginning. The observations for the import are therefore replaced rather
 * than added to, inside one transaction, so a second call leaves exactly what
 * the first would have and an interrupted one leaves nothing.
 *
 * ## It can be told to wait
 *
 * An import that claims the same moment as a different export of the Fleet,
 * and is not the first version of that moment the site saw, is held rather
 * than read into observations: which of the two is the roster at that moment
 * is somebody's decision. It is checked only once the file has read, because
 * a file that does not read is refused whatever else is true of it.
 */
@Injectable()
export class RosterImportPublisher
  implements RestrictedAssetPublisher, OnModuleInit
{
  private readonly _logger = new Logger(RosterImportPublisher.name);

  /** The kind of record this publishes for. */
  readonly subject = FileAssetSubject.ROSTER_IMPORT;

  /**
   * Creates an instance of RosterImportPublisher.
   *
   * @param _imports - Repository of import provenance records.
   * @param _observations - Repository of roster observations.
   * @param _typedParser - The reader that turns the sanitised file into
   *   values.
   * @param _registry - Which publisher writes which table.
   * @param _conflicts - Says whether an import has to wait.
   */
  constructor(
    @InjectRepository(RosterImportSourceEntity)
    private readonly _imports: Repository<RosterImportSourceEntity>,
    @InjectRepository(RosterObservationEntity)
    private readonly _observations: Repository<RosterObservationEntity>,
    private readonly _typedParser: RosterTypedParserService,
    private readonly _registry: AssetPublisherRegistry,
    private readonly _conflicts: RosterImportConflictService,
  ) {}

  /**
   * Registers this publisher with the registry.
   */
  onModuleInit(): void {
    this._registry.registerRestricted(this);
  }

  /**
   * Reads a cleared export into the import's observations.
   *
   * @param attachment - The import, and the bytes the scanner cleared.
   * @returns Whether the file was read into observations.
   */
  async receive(
    attachment: RestrictedAssetAttachment,
  ): Promise<RestrictedAssetReceipt> {
    const record = await this._imports.findOne({
      where: { id: attachment.subjectId },
    });

    if (record === null || record.assetId !== attachment.assetId) {
      return this.refuse(
        attachment,
        RosterPublicationRejectionCode.NOT_THIS_IMPORT,
      );
    }

    if (record.exportTimezone === null) {
      return this.refuse(
        attachment,
        RosterPublicationRejectionCode.EXPORT_TIMEZONE_MISSING,
      );
    }

    const typed = this._typedParser.read(
      attachment.bytes,
      record.exportTimezone,
    );

    if (typed.problems.length > 0) {
      record.publicationProblems = typed.problems.map(problem => ({
        ...problem,
      }));

      await this._imports.save(record);

      return this.refuse(attachment, RosterCsvRejectionCode.ROWS_UNREADABLE);
    }

    if (await this._conflicts.isHeld(record)) {
      this._logger.log(
        `[receive] Roster held for a conflicting export - ` +
          `ImportId: ${record.id}, AssetId: ${attachment.assetId}, ` +
          `ConflictGroupId: ${record.conflictGroupId}`,
      );

      return {
        outcome: 'HELD',
        reason: RosterHoldReason.EXPORT_INSTANT_IN_CONFLICT,
      };
    }

    const observations = typed.rows.map(row => this.observe(record, row));

    await this._observations.manager.transaction(async manager => {
      await manager.delete(RosterObservationEntity, {
        importSourceId: record.id,
      });

      for (
        let start = 0;
        start < observations.length;
        start += OBSERVATION_INSERT_BATCH
      ) {
        await manager.insert(
          RosterObservationEntity,
          observations.slice(start, start + OBSERVATION_INSERT_BATCH),
        );
      }
    });

    this._logger.log(
      `[receive] Roster read into observations - ImportId: ${record.id}, ` +
        `AssetId: ${attachment.assetId}, Rows: ${observations.length}`,
    );

    return { outcome: 'ACCEPTED' };
  }

  /**
   * Turns one read row into the observation stored for it.
   *
   * @param record - The import it belongs to.
   * @param row - The row as the typed reader made it.
   * @returns The observation, ready to insert.
   */
  private observe(
    record: RosterImportSourceEntity,
    row: RosterObservationRow,
  ): Partial<RosterObservationEntity> {
    const joined = this.instant(row.joinedAt);
    const rankChanged = this.instant(row.rankChangedAt);
    const lastActive = this.instant(row.lastActiveAt);
    const commentEdited = this.instant(row.publicCommentEditedAt);

    return {
      importSourceId: record.id,
      fleetId: record.fleetId,
      line: row.line,
      characterName: row.characterName,
      characterNameNormalised: normaliseRosterCharacterName(row.characterName),
      accountHandle: row.accountHandle,
      accountHandleNormalised: normaliseRosterAccountHandle(row.accountHandle),
      level: row.level,
      className: row.className,
      profession: row.profession,
      guildRank: row.guildRank,
      // A bigint column, which TypeORM reads back as a string. Written the
      // same way so the entity has one type for it in both directions.
      contributionTotal: String(row.contributionTotal),
      joinedAtLocal: joined.local,
      joinedAt: joined.at,
      joinedAtAmbiguous: joined.ambiguous,
      rankChangedAtLocal: rankChanged.local,
      rankChangedAt: rankChanged.at,
      rankChangedAtAmbiguous: rankChanged.ambiguous,
      lastActiveAtLocal: lastActive.local,
      lastActiveAt: lastActive.at,
      lastActiveAtAmbiguous: lastActive.ambiguous,
      status: row.status,
      publicComment: row.publicComment,
      publicCommentEditedAtLocal: commentEdited.local,
      publicCommentEditedAt: commentEdited.at,
      publicCommentEditedAtAmbiguous: commentEdited.ambiguous,
    };
  }

  /**
   * Reduces one date to the three columns every date is stored as.
   *
   * On the morning a clock went back a local time names two instants, and the
   * earlier is recorded with the ambiguity flagged rather than the choice
   * hidden — plan section 3.4. The local text is kept either way, so a
   * later correction has something to re-read.
   *
   * @param date - The date as the typed reader made it.
   * @returns The local text, the instant it was read as and whether that
   *   instant was one of two.
   */
  private instant(date: RosterDate): {
    local: string | null;
    at: Date | null;
    ambiguous: boolean;
  } {
    return {
      local: date.local,
      at: date.candidates[0] ?? null,
      ambiguous: date.candidates.length > 1,
    };
  }

  /**
   * Refuses a cleared file.
   *
   * @param attachment - What was handed over.
   * @param rejectionCode - Why it was refused.
   * @returns The refusal.
   */
  private refuse(
    attachment: RestrictedAssetAttachment,
    rejectionCode: string,
  ): RestrictedAssetReceipt {
    this._logger.warn(
      `[receive] Roster not read into observations - ImportId: ` +
        `${attachment.subjectId}, AssetId: ${attachment.assetId}, ` +
        `Code: ${rejectionCode}`,
    );

    return { outcome: 'REFUSED', rejectionCode };
  }
}
