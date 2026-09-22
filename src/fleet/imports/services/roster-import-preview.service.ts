import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { StoFleetEntity } from '../../entities/sto-fleet.entity';
import { ROSTER_PREVIEW_SAMPLE_ROWS } from '../constants/roster-typed.constants';
import {
  RosterImportPreviewDto,
  RosterPreviewDateDto,
  RosterPreviewRowDto,
} from '../dto/roster-import-preview.dto';
import { RosterCsvRejectedError } from '../errors/roster-csv-rejected.error';
import { assertRosterFilenameUsable } from '../utilities/roster-filename.utility';
import {
  RosterCsvPrivacyParserService,
  SanitisedRoster,
} from './roster-csv-privacy-parser.service';
import { RosterExportIdentityService } from './roster-export-identity.service';
import {
  RosterDate,
  RosterObservationRow,
  RosterTypedParserService,
} from './roster-typed-parser.service';

/** What the controller knows about a file somebody wants checked. */
export interface RosterPreviewInput {
  /** The Fleet the export would be imported into. */
  readonly fleet: StoFleetEntity;

  /** The filename as the browser sent it. */
  readonly originalFilename: string;

  /** The IANA zone the uploader says the export was taken in. */
  readonly timezone: string;

  /**
   * The received bytes.
   *
   * **Overwritten in place before this method returns**, whether it succeeds
   * or fails. The caller must not read the buffer afterwards.
   */
  readonly source: Buffer;
}

/**
 * Reads an export as far as it can be read, and keeps none of it.
 *
 * The dry run behind the import wizard's first step. Everything the real
 * upload would do to decide whether a file is believable happens here — the
 * privacy parser, the typed reader, the filename check — and then the bytes
 * are thrown away. No asset is registered, nothing is written to a bucket, no
 * provenance row exists and no scan is requested.
 *
 * ## Why a preview exists at all
 *
 * Because the uploader has to supply something the file does not contain, and
 * can supply it wrongly without noticing. An STO export writes wall-clock
 * times with no zone; choosing the wrong one moves every date in the file by
 * a few hours, which is invisible in a list of dates and obvious in a
 * before-and-after. Handing somebody back the first rows of their own export,
 * read both ways, is the only honest way to ask "is this what you meant".
 *
 * It is also how the one question the importer cannot answer for itself gets
 * asked. On the morning the clocks go back a filename stamp of `01:30` names
 * two instants an hour apart, and which of them is right decides which of two
 * snapshots is the later. Plan section 3.4 requires the candidates be handed
 * back for an explicit answer, and a screen that has already shown the file is
 * otherwise fine is where that answer is worth asking for.
 *
 * ## The sample discloses nothing
 *
 * It is the caller's own file, read back to the caller, bounded to the first
 * few rows. They hold the original; this tells them only how it was
 * understood. Officer columns cannot appear in it because the privacy parser
 * has already discarded them and nothing downstream has ever held one.
 */
@Injectable()
export class RosterImportPreviewService {
  private readonly _logger = new Logger(RosterImportPreviewService.name);

  /**
   * Creates an instance of RosterImportPreviewService.
   *
   * @param _parser - The privacy boundary.
   * @param _typedParser - The reader that turns the sanitised file into
   *   values.
   * @param _identityService - Reads the filename against the Fleet.
   */
  constructor(
    private readonly _parser: RosterCsvPrivacyParserService,
    private readonly _typedParser: RosterTypedParserService,
    private readonly _identityService: RosterExportIdentityService,
  ) {}

  /**
   * Reports how an export would be read, without reading it into anything.
   *
   * @param input - The Fleet, the file and the zone it was taken in.
   * @returns The reading, whether or not it could be imported.
   * @throws BadRequestException when the file is not an STO roster export at
   *   all. The body carries a structural code and, where one applies, the line
   *   at fault; it never carries any part of the file.
   */
  async preview(input: RosterPreviewInput): Promise<RosterImportPreviewDto> {
    const sourceByteSize = input.source.length;

    let sourceSha256: string;
    let sanitised: SanitisedRoster;

    // Everything that touches the received bytes happens inside this block,
    // and the block disposes of them however it ends. A refused preview is
    // exactly the file somebody would otherwise be tempted to keep a sample
    // of — ADR-0001.
    try {
      assertRosterFilenameUsable(input.originalFilename);

      sourceSha256 = createHash('sha256').update(input.source).digest('hex');
      sanitised = this._parser.sanitise(input.source);
    } catch (error) {
      if (!(error instanceof RosterCsvRejectedError)) {
        throw error;
      }

      this._logger.warn(
        `[preview] Roster export refused - Code: ${error.code}, ` +
          `Line: ${error.line ?? 'n/a'}`,
      );

      throw error.toBadRequest();
    } finally {
      input.source.fill(0);
    }

    const typed = this._typedParser.read(sanitised.csv, input.timezone);
    const identity = await this._identityService.identify({
      fleet: input.fleet,
      filename: input.originalFilename,
      timezone: input.timezone,
    });

    return {
      // Three separate reasons a file is not ready, and all three have to be
      // absent. An unanswered ambiguous stamp is the one that is nobody's
      // mistake: the file is fine and the question is still open.
      canImport:
        identity.rejection === null &&
        identity.exportedAt !== null &&
        typed.problems.length === 0,
      timezone: input.timezone,
      filename: {
        rejection: identity.rejection,
        fleetLabel: identity.fleetLabel,
        localStamp: identity.localStamp,
        exportedAt: identity.exportedAt?.toISOString() ?? null,
        exportedAtCandidates: identity.candidates.map(candidate =>
          candidate.toISOString(),
        ),
        matchedAlias: identity.matchedAlias,
      },
      source: {
        headerShape: sanitised.headerShape,
        rowCount: sanitised.rowCount,
        officerTailRowCount: sanitised.officerTailRowCount,
        parserVersion: sanitised.parserVersion,
        sourceSha256,
        sourceByteSize,
      },
      readableRowCount: typed.rows.length,
      unknownClassCount: typed.unknownClassCount,
      ambiguousDateCount: typed.ambiguousDateCount,
      problems: typed.problems.map(problem => ({ ...problem })),
      sample: typed.rows
        .slice(0, ROSTER_PREVIEW_SAMPLE_ROWS)
        .map(row => this.toSampleRow(row)),
    };
  }

  /**
   * Draws one row as the preview shows it.
   *
   * The public comment and the status are left out. Neither helps anybody
   * check a timezone, and the sample exists to answer one question rather
   * than to be a roster viewer — FC-020 builds that, behind the audience
   * checks it needs.
   *
   * @param row - The row as the typed reader made it.
   * @returns The row as the wizard draws it.
   */
  private toSampleRow(row: RosterObservationRow): RosterPreviewRowDto {
    return {
      line: row.line,
      characterName: row.characterName,
      accountHandle: row.accountHandle,
      level: row.level,
      className: row.className,
      profession: row.profession,
      guildRank: row.guildRank,
      contributionTotal: row.contributionTotal,
      joinedAt: this.toSampleDate(row.joinedAt),
      rankChangedAt: this.toSampleDate(row.rankChangedAt),
      lastActiveAt: this.toSampleDate(row.lastActiveAt),
    };
  }

  /**
   * Draws one date both ways: as the file wrote it, and as it was read.
   *
   * @param date - The date as the typed reader made it.
   * @returns The date as the wizard draws it.
   */
  private toSampleDate(date: RosterDate): RosterPreviewDateDto {
    return {
      resolution: date.resolution,
      local: date.local,
      candidates: date.candidates.map(candidate => candidate.toISOString()),
    };
  }
}
