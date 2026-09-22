import { ApiProperty } from '@nestjs/swagger';

import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

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

  @ApiProperty({ description: 'When the upload was accepted.' })
  uploadedAt: Date;
}
