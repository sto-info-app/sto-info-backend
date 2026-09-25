import { ApiProperty } from '@nestjs/swagger';

import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { RosterImportStatus } from '../enums/roster-import-status.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';

/**
 * What an uploader is told about an export that was accepted.
 *
 * Deliberately a report about the *file*, not about its contents. No roster
 * row, no Character name, no comment and — obviously — no officer note. The
 * numbers are counts, the hashes are hashes, and the only free text is the
 * filename the uploader supplied in the first place.
 *
 * `officerTailRowCount` is here rather than hidden because the person who
 * uploaded the file should be told plainly what was thrown away. ADR-0001
 * requires the product to say that officer columns are discarded at upload;
 * a number in the response is the least deniable way of saying it.
 *
 * The export provenance is here for the same reason. What this application
 * decided the filename meant — which zone, which stamp, which instant, and
 * whether anybody had to choose between two — is read straight back to the
 * person who uploaded it, while they are still looking at the file and can
 * still tell that it is wrong.
 *
 * Those three are nullable because the column is, not because the fact can
 * be missing: nothing writes a row without them. The nullability belongs to
 * rows that predate the columns, and this shape is also what a listing of a
 * Fleet's imports returns.
 *
 * `status` is what to show; `state` is kept beside it because it is the
 * asset's own word and an investigator comparing an import with the asset
 * registry needs the registry's vocabulary. `statusReason` is a code and
 * never a scanner's: a refusal the scanner made is reported as
 * `SCAN_REFUSED` whoever is asking, because naming what matched tells
 * somebody probing the scanner what gets through (R24).
 */
export class RosterImportSourceDto {
  @ApiProperty({ description: 'The provenance record.' })
  id: string;

  @ApiProperty({ description: 'The registry entry for the stored file.' })
  assetId: string;

  @ApiProperty({ description: 'The Fleet it was uploaded against.' })
  fleetId: string;

  @ApiProperty({ description: 'The filename as uploaded.' })
  originalFilename: string;

  @ApiProperty({
    description: 'SHA-256 of the bytes received. Those bytes are not kept.',
  })
  sourceSha256: string;

  @ApiProperty({
    description: 'SHA-256 of the sanitised CSV, which is what is kept.',
  })
  sanitisedSha256: string;

  @ApiProperty({ description: 'How many bytes were received.' })
  sourceByteSize: number;

  @ApiProperty({ description: 'How many bytes were retained.' })
  sanitisedByteSize: number;

  @ApiProperty({
    description: 'Which export header the file carried.',
    enum: RosterSourceHeaderShape,
  })
  sourceHeaderShape: RosterSourceHeaderShape;

  @ApiProperty({
    description:
      'The IANA zone the uploader said the export was taken in. Recorded ' +
      'beside the stamp rather than folded into it, so an instant read ' +
      'from the wrong zone can be told apart from one read correctly.',
    nullable: true,
  })
  exportTimezone: string | null;

  @ApiProperty({
    description:
      'The wall-clock stamp the filename carried, exactly as written.',
    nullable: true,
  })
  exportLocalStamp: string | null;

  @ApiProperty({
    description: 'When the export was taken, as that stamp reads in that zone.',
    nullable: true,
  })
  exportedAt: Date | null;

  @ApiProperty({
    description:
      'Whether that instant was chosen between two. True only for a stamp ' +
      'the clock went back over, where the upload had to say which.',
  })
  exportedAtAmbiguous: boolean;

  @ApiProperty({ description: 'How many roster rows it held.' })
  rowCount: number;

  @ApiProperty({
    description: 'How many officer notes were discarded at upload.',
  })
  officerTailRowCount: number;

  @ApiProperty({ description: 'The parser version that produced the file.' })
  parserVersion: number;

  @ApiProperty({
    description:
      'Where the stored file has got to. It stays QUARANTINED until a ' +
      'scanner has looked at it; nothing reads it before then.',
    enum: FileAssetState,
  })
  state: FileAssetState;

  @ApiProperty({
    description: 'When the sanitised file may be destroyed.',
    nullable: true,
  })
  retainUntil: Date | null;

  @ApiProperty({
    description:
      'The conflict group this import is in, when another export of the ' +
      'Fleet claims the same moment and says something different. The first ' +
      'version of the moment stays in force and any import differing from ' +
      'it waits until somebody decides which stands. Null when nothing ' +
      'disagrees.',
    nullable: true,
  })
  conflictGroupId: string | null;

  @ApiProperty({
    description: 'Where the import has got to.',
    enum: RosterImportStatus,
  })
  status: RosterImportStatus;

  @ApiProperty({
    description:
      'Why it is HELD or REFUSED, as a code. For a refusal, the structural ' +
      'code when the file was refused for what its rows hold, and ' +
      'SCAN_REFUSED for anything the scanner refused, whoever is asking. ' +
      'Null for every other status.',
    nullable: true,
    example: 'ROWS_UNREADABLE',
  })
  statusReason: string | null;

  @ApiProperty({
    description:
      'How many row problems stopped it being read. Which rows, which ' +
      'columns and which codes are for whoever investigates imports.',
  })
  problemCount: number;

  @ApiProperty({
    description:
      'The username of whoever uploaded it, or null once that account is ' +
      'gone.',
    nullable: true,
  })
  uploadedByName: string | null;

  @ApiProperty({ description: 'When the upload was accepted.' })
  uploadedAt: Date;

  @ApiProperty({
    description:
      'Whether an investigator has taken it out of the Fleet’s history. It ' +
      'stays as evidence and counts for nothing until it is reinstated.',
  })
  excluded: boolean;

  @ApiProperty({
    description:
      'Whether an investigator has said it may not list everybody, so ' +
      'nobody missing from it is taken to have left.',
  })
  partial: boolean;
}
