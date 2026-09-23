import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { QueryFailedError, Repository } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { FileAssetPlacementService } from 'src/file-assets/services/file-asset-placement.service';
import { FileAssetService } from 'src/file-assets/services/file-asset.service';
import { QuarantineStorageService } from 'src/file-assets/services/quarantine-storage.service';
import { ScanRequestProducerService } from 'src/file-scanning/services/scan-request-producer.service';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { FleetPolicyService } from '../../fleet-policy.service';
import {
  boundDeclaredContentType,
  DECLARED_ROSTER_CONTENT_TYPE,
  SANITISED_ROSTER_CONTENT_TYPE,
} from '../constants/roster-upload.constants';
import { RosterImportSourceEntity } from '../entities/roster-import-source.entity';
import { RosterCsvRejectionCode } from '../enums/roster-csv-rejection-code.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterRepeatRejectionCode } from '../enums/roster-repeat-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';
import { RosterCsvRejectedError } from '../errors/roster-csv-rejected.error';
import { assertRosterFilenameUsable } from '../utilities/roster-filename.utility';
import { RosterCsvPrivacyParserService } from './roster-csv-privacy-parser.service';
import { RosterExportIdentityService } from './roster-export-identity.service';
import { RosterImportConflictService } from './roster-import-conflict.service';
import { RosterTypedParserService } from './roster-typed-parser.service';

/** What the controller knows about an arriving upload. */
export interface RosterUploadInput {
  /** The Fleet the export was uploaded against. */
  readonly fleet: StoFleetEntity;
  /** The IANA zone the uploader says the export was taken in. */
  readonly timezone: string;
  /**
   * Which moment the filename stamp names, where it names two.
   *
   * Null for the ordinary case. Supplied only for a stamp the clock went
   * back over, and checked against the two the stamp could mean rather than
   * believed: an export instant decides the order of a Fleet’s history.
   */
  readonly chosenExportedAt: Date | null;
  /** Who is uploading. */
  readonly uploadedByUserId: string;
  /** The filename as the browser sent it. */
  readonly originalFilename: string;
  /** What the browser claimed the file was. Recorded, never believed. */
  readonly declaredContentType: string | null;
  /**
   * The received bytes.
   *
   * **Overwritten in place before this method returns**, whether it succeeds
   * or fails. The caller must not read the buffer afterwards.
   */
  readonly source: Buffer;
}

/** An upload that was accepted. */
export interface AcceptedRosterUpload {
  /** The provenance record. */
  readonly record: RosterImportSourceEntity;
  /** The registry entry for the stored sanitised CSV. */
  readonly asset: FileAssetEntity;
  /**
   * The identifier the scan request carries, for following it in the logs.
   * Null for a repeat, which requested no scan.
   */
  readonly traceId: string | null;
  /**
   * Whether this Fleet had already imported the file, so that what is
   * returned is the import the earlier upload made rather than a new one.
   */
  readonly repeated: boolean;
}

/** When an export was taken, once nothing about it is still open. */
interface SettledExport {
  /** The Fleet label the filename carried. */
  readonly filenameFleetLabel: string;

  /** The local wall-clock stamp it carried. */
  readonly exportLocalStamp: string;

  /** When it was taken. */
  readonly exportedAt: Date;

  /** Whether that instant was chosen between two. */
  readonly exportedAtAmbiguous: boolean;

  /** The recorded former name it matched, or null for the current one. */
  readonly matchedAliasId: string | null;
}

/** What the parser reports about an upload, beyond the bytes it produced. */
interface SanitisedSummary {
  /** Which of the two export headers the upload carried. */
  readonly sourceHeaderShape: RosterSourceHeaderShape;
  /** How many data rows it held. */
  readonly rowCount: number;
  /** How many of those carried an officer tail that was discarded. */
  readonly officerTailRowCount: number;
  /** The grammar and redaction version that produced the bytes. */
  readonly parserVersion: number;
}

/** How many milliseconds there are in a day. */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The index that makes one file one import, per Fleet. */
const SOURCE_HASH_INDEX = 'UQ_roster_import_source_fleet_hash';

/**
 * Takes an uploaded roster export as far as private quarantine, and no
 * further.
 *
 * The order of what happens here is the ticket. The bytes are hashed, parsed
 * and redacted *before* a registry row exists, before an object is written and
 * before anything is logged, so that the three officer columns are gone by the
 * time any of those sinks is constructed. Nothing downstream has to remember
 * to avoid them, because by then there is nothing to avoid.
 *
 * ## The raw buffer
 *
 * It is overwritten with zeroes in a `finally`, so the disposal happens on the
 * failure path as well as the success one — and the failure path is the one
 * that matters, because a rejected upload is exactly the upload somebody would
 * otherwise be tempted to keep a sample of. ADR-0001 is explicit: no raw
 * failure sample, including in Sentry, dead-letter payloads or backups.
 *
 * Node cannot promise that no copy of those bytes remains anywhere in the
 * heap — a `Buffer` may have been moved by the garbage collector before this
 * runs. What zeroing does guarantee is that the object every caller in this
 * process still holds a reference to, including Multer's, no longer contains
 * the file. That is the difference between "the officer columns are gone" and
 * "nothing we wrote goes looking for them".
 *
 * ## What it does not do
 *
 * It does not enqueue a scan, because there is no scanner yet: the asset is
 * left `QUARANTINED` and FC-010 claims it from there. It makes no roster
 * observations at all: those are read from the sanitised file once something
 * has said it is safe to read, which is a different moment and a different
 * service.
 *
 * ## The same file twice
 *
 * A file this Fleet has already imported is answered with the import it
 * made, found by the hash of the bytes received and before anything else is
 * read, stored or scanned. The lookup is by Fleet and hash together, never by
 * hash alone, so whether another Fleet holds the same file is not something
 * this can say. The same bytes with a different reading — another zone,
 * another instant — are refused rather than answered, because the earlier
 * reading is the one that stands. Two copies arriving together are settled by
 * the unique index, and the one that loses gives back what it stored.
 *
 * ## The same moment, said differently
 *
 * An import is recorded in one transaction with its conflict group, so none
 * is ever recorded without having been compared with every other export of
 * the Fleet claiming the same instant. See {@link RosterImportConflictService}.
 *
 * It does read the filename, but it decides nothing about it on its own:
 * the grammar, the Fleet label and the export instant all come back from
 * {@link RosterExportIdentityService}, the same service the preview asks,
 * so the two cannot tell an uploader different things about one file.
 */
@Injectable()
export class RosterImportIngressService {
  private readonly _logger = new Logger(RosterImportIngressService.name);

  /**
   * Creates an instance of RosterImportIngressService.
   *
   * @param _repository - Repository of roster import provenance records.
   * @param _parser - The privacy boundary.
   * @param _identityService - Reads the filename against the Fleet.
   * @param _fileAssetService - The asset registry.
   * @param _placementService - Which asset is waiting to go into force.
   * @param _quarantineStorage - The private bucket.
   * @param _policyService - Supplies the published retention window.
   * @param _conflicts - Groups exports that claim the same moment.
   */
  constructor(
    @InjectRepository(RosterImportSourceEntity)
    private readonly _repository: Repository<RosterImportSourceEntity>,
    private readonly _parser: RosterCsvPrivacyParserService,
    private readonly _typedParser: RosterTypedParserService,
    private readonly _identityService: RosterExportIdentityService,
    private readonly _fileAssetService: FileAssetService,
    private readonly _placementService: FileAssetPlacementService,
    private readonly _quarantineStorage: QuarantineStorageService,
    private readonly _scanRequestProducer: ScanRequestProducerService,
    private readonly _policyService: FleetPolicyService,
    private readonly _conflicts: RosterImportConflictService,
  ) {}

  /**
   * Accepts an upload, or refuses it without keeping any of it.
   *
   * @param input - What arrived.
   * @returns The provenance record and the registry entry.
   * @throws BadRequestException when the upload is refused. The body carries a
   *   structural code and, where one applies, a line number — never content.
   */
  async accept(input: RosterUploadInput): Promise<AcceptedRosterUpload> {
    const sourceByteSize = input.source.length;

    // Everything that touches the received bytes happens inside this block,
    // and the block disposes of them however it ends.
    let sourceSha256: string;
    let sanitisedCsv: Buffer;
    let summary: SanitisedSummary;
    let settled: SettledExport;

    try {
      assertRosterFilenameUsable(input.originalFilename);

      // Before a byte is read. The name says which Fleet this is and when it
      // was taken, and a file whose name proves neither is not worth parsing
      // — nor worth holding while somebody decides.
      settled = await this.settleExport(input);

      sourceSha256 = this.hash(input.source);

      // Before the file is read any further. What a repeat would produce has
      // already been kept, scanned and read once.
      const earlier = await this.findEarlier(input.fleet.id, sourceSha256);

      if (earlier !== null) {
        return this.repeat(earlier, input.timezone, settled);
      }

      const sanitised = this._parser.sanitise(input.source);

      this.assertRowsReadable(sanitised.csv, input.timezone);

      sanitisedCsv = sanitised.csv;
      summary = {
        sourceHeaderShape: sanitised.headerShape,
        rowCount: sanitised.rowCount,
        officerTailRowCount: sanitised.officerTailRowCount,
        parserVersion: sanitised.parserVersion,
      };
    } catch (error) {
      // A bug in this service is not a complaint about somebody's file and
      // must not be reported to them as one.
      if (!(error instanceof RosterCsvRejectedError)) {
        throw error;
      }

      throw this.refuse(error);
    } finally {
      input.source.fill(0);
    }

    const sanitisedSha256 = this.hash(sanitisedCsv);

    const asset = await this._fileAssetService.register({
      kind: FileAssetKind.ROSTER_IMPORT_SOURCE,
      // Not SCOPE. A scoped audience would make the sanitised CSV reachable
      // through the generic delivery endpoint by anyone the Fleet's audience
      // policy admits, and a roster export holds every member's handle and
      // Last Active. Its readers are whoever holds `roster.source.download`,
      // which is a capability rather than an audience, and the route that
      // honours it is FC-037's. Until then nothing serves these bytes, which
      // is the correct state for a file no scanner has looked at.
      audience: FileAssetAudience.RESTRICTED,
      ownerUserId: input.uploadedByUserId,
      fleetId: input.fleet.id,
      // What this application wrote, not what arrived. The registered asset
      // is the sanitised CSV the serialiser below produced; the uploaded
      // file no longer exists by the time this row does. The worker checks
      // this claim against the bytes, so it has to describe the bytes it
      // will actually read — ADR-0020. The uploader's own Content-Type is
      // kept on the provenance record instead.
      declaredContentType: DECLARED_ROSTER_CONTENT_TYPE,
      originalFilename: input.originalFilename,
      retainUntil: this.retainUntil(),
    });

    const objectKey = this._quarantineStorage.buildObjectKey(asset.id);
    const stored = await this._quarantineStorage.put(objectKey, sanitisedCsv);

    const quarantined = await this._fileAssetService.recordStored(asset.id, {
      objectKey: stored.objectKey,
      objectVersion: stored.objectVersion,
      sha256: sanitisedSha256,
      byteSize: sanitisedCsv.length,
      detectedContentType: SANITISED_ROSTER_CONTENT_TYPE,
    });

    let record: RosterImportSourceEntity;

    try {
      record = await this._repository.manager.transaction(async manager => {
        const imports = manager.getRepository(RosterImportSourceEntity);
        const created = await imports.save(
          imports.create({
            assetId: asset.id,
            fleetId: input.fleet.id,
            uploadedByUserId: input.uploadedByUserId,
            originalFilename: input.originalFilename,
            declaredContentType: boundDeclaredContentType(
              input.declaredContentType,
            ),
            sourceSha256,
            sanitisedSha256,
            sourceByteSize: String(sourceByteSize),
            sanitisedByteSize: String(sanitisedCsv.length),
            exportTimezone: input.timezone,
            ...settled,
            ...summary,
          }),
        );

        const group = await this._conflicts.group(
          manager,
          created,
          settled.exportedAt,
        );

        created.conflictGroupId = group === null ? null : group.id;

        return created;
      });
    } catch (error) {
      return this.settleRace(error, {
        assetId: asset.id,
        objectKey: stored.objectKey,
        fleetId: input.fleet.id,
        sourceSha256,
        timezone: input.timezone,
        settled,
      });
    }

    // Claimed against the import rather than the Fleet: a Fleet has a
    // history of imports, and a placement keyed by the Fleet would let each
    // upload supersede the last. The placement is what a clean verdict is
    // published into, and until it is active nothing read from this file is
    // in force.
    await this._placementService.placePending({
      assetId: asset.id,
      subject: FileAssetSubject.ROSTER_IMPORT,
      subjectId: record.id,
      slot: FileAssetSlot.SOURCE,
    });

    // The provenance row and the placement are written before the scan is
    // requested. A crash between them leaves an asset in QUARANTINED with
    // nothing scanning it, which is safe and recoverable; the other order
    // would leave a scanned asset with no record of where it came from, or
    // nothing waiting to publish it, which is not.
    const scanning = await this._scanRequestProducer.requestScan(quarantined);

    // Identifiers and counts. Not the filename: it is text somebody supplied,
    // it is not subject to the parser's control-character rule, and a log line
    // is a sink like any other.
    this._logger.log(
      `[accept] Roster export quarantined - AssetId: ${asset.id}, ` +
        `FleetId: ${input.fleet.id}, Rows: ${summary.rowCount}, ` +
        `ExportedAt: ${settled.exportedAt.toISOString()}, ` +
        `OfficerTailsDiscarded: ${summary.officerTailRowCount}, ` +
        `Header: ${summary.sourceHeaderShape}, ` +
        `ParserVersion: ${summary.parserVersion}, ` +
        `ConflictGroupId: ${record.conflictGroupId ?? 'none'}, ` +
        `TraceId: ${scanning.traceId}`,
    );

    return {
      record,
      asset: scanning.asset,
      traceId: scanning.traceId,
      repeated: false,
    };
  }

  /**
   * Finds the import this Fleet already made from a file.
   *
   * @param fleetId - The Fleet. Never omitted: a lookup by hash alone would
   *   say whether any Fleet had imported the file.
   * @param sourceSha256 - The hash of the bytes received.
   * @returns The earlier import with its asset, or null.
   */
  private async findEarlier(
    fleetId: string,
    sourceSha256: string,
  ): Promise<RosterImportSourceEntity | null> {
    return this._repository.findOne({
      where: { fleetId, sourceSha256 },
      relations: { asset: true },
    });
  }

  /**
   * Answers an upload of a file this Fleet has already imported.
   *
   * @param earlier - The import the first upload made.
   * @param timezone - The zone this upload stated.
   * @param settled - The export instant this upload's name settled on.
   * @returns The earlier import, marked as a repeat.
   * @throws ConflictException when this upload read the file differently.
   */
  private repeat(
    earlier: RosterImportSourceEntity,
    timezone: string,
    settled: SettledExport,
  ): AcceptedRosterUpload {
    const readsTheSame =
      earlier.exportTimezone === timezone &&
      earlier.exportedAt?.getTime() === settled.exportedAt.getTime();

    if (!readsTheSame) {
      this._logger.warn(
        `[accept] Roster export repeated with a different reading - ` +
          `ImportId: ${earlier.id}, FleetId: ${earlier.fleetId}`,
      );

      // The earlier reading is named so the uploader can see which of the
      // two is wrong. Every value in it is one this application wrote.
      throw new ConflictException({
        message:
          'This roster export has already been imported for this Fleet, ' +
          'read in a different timezone or at a different time. The ' +
          'earlier import stands; nothing new has been imported.',
        code: RosterRepeatRejectionCode.ALREADY_IMPORTED_DIFFERENTLY,
        importId: earlier.id,
        exportTimezone: earlier.exportTimezone,
        exportLocalStamp: earlier.exportLocalStamp,
        exportedAt: earlier.exportedAt,
      });
    }

    this._logger.log(
      `[accept] Roster export repeated - ImportId: ${earlier.id}, ` +
        `AssetId: ${earlier.assetId}, FleetId: ${earlier.fleetId}`,
    );

    return {
      record: earlier,
      asset: earlier.asset,
      traceId: null,
      repeated: true,
    };
  }

  /**
   * Answers the loser of two uploads of one file that arrived together.
   *
   * Both found no earlier import and both stored a copy; the unique index let
   * one of them record it. This one gives its copy back — the asset is
   * discarded before its object is removed, because the row is what decides
   * whether anything could serve it — and is answered as a repeat of the
   * winner.
   *
   * @param error - Whatever the insert threw.
   * @param loser - What this upload stored, and how it read the file.
   * @returns The winner's import, marked as a repeat.
   * @throws The original error, when it was anything other than this race.
   */
  private async settleRace(
    error: unknown,
    loser: {
      readonly assetId: string;
      readonly objectKey: string;
      readonly fleetId: string;
      readonly sourceSha256: string;
      readonly timezone: string;
      readonly settled: SettledExport;
    },
  ): Promise<AcceptedRosterUpload> {
    const raced =
      error instanceof QueryFailedError &&
      error.message.includes(SOURCE_HASH_INDEX);

    const earlier = raced
      ? await this.findEarlier(loser.fleetId, loser.sourceSha256)
      : null;

    if (earlier === null) {
      throw error;
    }

    await this._fileAssetService.discard(
      loser.assetId,
      'Repeated upload: a concurrent upload of the same file was recorded first',
    );

    try {
      await this._quarantineStorage.remove(loser.objectKey);
    } catch (removal: unknown) {
      // The row already says nothing may serve these bytes. An object left
      // behind is an orphan in a private bucket, which W10's inventory finds;
      // failing the upload over it would tell somebody their file was
      // refused when it was imported.
      this._logger.error(
        `[accept] Could not remove a repeated upload's copy - ` +
          `AssetId: ${loser.assetId}, ` +
          `Reason: ${removal instanceof Error ? removal.message : 'unknown'}`,
      );
    }

    return this.repeat(earlier, loser.timezone, loser.settled);
  }

  /**
   * Settles which Fleet an export is of and when it was taken, or refuses it.
   *
   * The filename is the only place either fact appears, so both are checked
   * against what is already registered rather than believed. What comes back
   * is the answer with nothing still open: an instant, and whether anybody
   * had to choose it.
   *
   * @param input - What arrived.
   * @returns The settled provenance.
   * @throws RosterCsvRejectedError when the name proves nothing, or when the
   *   stamp names two instants and the upload did not settle which.
   */
  private async settleExport(input: RosterUploadInput): Promise<SettledExport> {
    const identity = await this._identityService.identify({
      fleet: input.fleet,
      filename: input.originalFilename,
      timezone: input.timezone,
    });

    if (identity.rejection !== null) {
      throw new RosterCsvRejectedError(identity.rejection);
    }

    // Any instant the caller supplies has to be one the stamp could have
    // meant, whether or not there was a question. An arbitrary one would let
    // somebody reorder a Fleet's history by asserting a time the file does
    // not support.
    const chosen = input.chosenExportedAt;

    if (
      chosen !== null &&
      !identity.candidates.some(
        candidate => candidate.getTime() === chosen.getTime(),
      )
    ) {
      throw new RosterCsvRejectedError(
        RosterFilenameRejectionCode.STAMP_CHOICE_NOT_A_CANDIDATE,
      );
    }

    const exportedAt = identity.exportedAt ?? chosen;

    if (exportedAt === null) {
      throw new RosterCsvRejectedError(
        RosterFilenameRejectionCode.STAMP_CHOICE_REQUIRED,
      );
    }

    return {
      // Both are read off a name the grammar has already accepted, so
      // neither can be null by the time the rejection check above has passed.
      filenameFleetLabel: identity.fleetLabel as string,
      exportLocalStamp: identity.localStamp as string,
      exportedAt,
      exportedAtAmbiguous: identity.candidates.length > 1,
      matchedAliasId: identity.matchedAliasId,
    };
  }

  /**
   * Logs a refusal and turns it into the answer the uploader is given.
   *
   * @param error - The refusal.
   * @returns The exception to throw in its place.
   */
  private refuse(error: RosterCsvRejectedError): BadRequestException {
    this._logger.warn(
      `[accept] Roster export refused - Code: ${error.code}, ` +
        `Line: ${error.line ?? 'n/a'}, Problems: ${error.problems.length}`,
    );

    return error.toBadRequest();
  }

  /**
   * Refuses a file whose rows do not all hold values that can be read.
   *
   * The same reading the preview gives and the publisher will give again,
   * through the same zone. Done here as well as there because a file that
   * fails it can never become observations, and scanning one would spend a
   * scanner's time on bytes that are going to be thrown away. The sanitised
   * copy is overwritten before the refusal leaves, as the upload's own bytes
   * are.
   *
   * @param sanitised - The sanitised CSV.
   * @param timezone - The zone the export was taken in.
   * @throws RosterCsvRejectedError carrying every problem, when there are any.
   */
  private assertRowsReadable(sanitised: Buffer, timezone: string): void {
    const { problems } = this._typedParser.read(sanitised, timezone);

    if (problems.length === 0) {
      return;
    }

    sanitised.fill(0);

    throw new RosterCsvRejectedError(
      RosterCsvRejectionCode.ROWS_UNREADABLE,
      null,
      problems,
    );
  }

  /**
   * Hashes bytes.
   *
   * @param bytes - The bytes.
   * @returns Their SHA-256, lowercase hexadecimal.
   */
  private hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  /**
   * Works out when the sanitised source may be destroyed.
   *
   * Measured from upload rather than from the export's own date, so that a
   * historical export uploaded today still gets its full window — ADR-0001,
   * and the figure is the published one rather than a copy of it.
   *
   * @returns The retention deadline.
   */
  private retainUntil(): Date {
    return new Date(
      Date.now() +
        this._policyService.importSourceRetentionDays * MILLISECONDS_PER_DAY,
    );
  }
}
