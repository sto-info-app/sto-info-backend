import { ApiProperty } from '@nestjs/swagger';

import { RosterDateResolution } from '../enums/roster-date-resolution.enum';
import { RosterFilenameRejectionCode } from '../enums/roster-filename-rejection-code.enum';
import { RosterProfession } from '../enums/roster-profession.enum';
import { RosterRowRejectionCode } from '../enums/roster-row-rejection-code.enum';
import { RosterSourceHeaderShape } from '../enums/roster-source-header-shape.enum';

/** What an export's filename turned out to say. */
export class RosterPreviewFilenameDto {
  @ApiProperty({
    description: 'Why the name is evidence of nothing, or null when it is.',
    enum: RosterFilenameRejectionCode,
    nullable: true,
  })
  rejection: RosterFilenameRejectionCode | null;

  @ApiProperty({
    description: 'The Fleet label the name carries, exactly as written.',
    nullable: true,
  })
  fleetLabel: string | null;

  @ApiProperty({
    description: 'The local wall-clock stamp the name carries.',
    nullable: true,
  })
  localStamp: string | null;

  @ApiProperty({
    description:
      'When the export was taken, or null while that is not settled.',
    nullable: true,
  })
  exportedAt: string | null;

  @ApiProperty({
    description:
      'Every instant the stamp could name, earliest first. Two of them means ' +
      'the clock went back over that hour and the uploader has to say which ' +
      'they meant.',
    type: [String],
  })
  exportedAtCandidates: string[];

  @ApiProperty({
    description:
      'The former name this label matched, or null when it matched the ' +
      'Fleet’s current name.',
    nullable: true,
  })
  matchedAlias: string | null;
}

/** What the file itself turned out to be. */
export class RosterPreviewSourceDto {
  @ApiProperty({
    description: 'Which export header the file carried.',
    enum: RosterSourceHeaderShape,
  })
  headerShape: RosterSourceHeaderShape;

  @ApiProperty({ description: 'How many roster rows it held.' })
  rowCount: number;

  @ApiProperty({
    description:
      'How many of those carried an officer note. Counted here and discarded ' +
      'here: nothing downstream of the privacy parser has ever seen one.',
  })
  officerTailRowCount: number;

  @ApiProperty({ description: 'The parser version that read it.' })
  parserVersion: number;

  @ApiProperty({
    description:
      'SHA-256 of the bytes received. Computed to answer “is this the ' +
      'same file” without keeping any of it.',
  })
  sourceSha256: string;

  @ApiProperty({ description: 'How many bytes were received.' })
  sourceByteSize: number;
}

/** Something about a row that stops the export being believed. */
export class RosterPreviewProblemDto {
  @ApiProperty({
    description: 'What is wrong. Structural, never a value out of the file.',
    enum: RosterRowRejectionCode,
  })
  code: RosterRowRejectionCode;

  @ApiProperty({ description: 'Which line of the file, counting from one.' })
  line: number;

  @ApiProperty({
    description: 'Which column, or null when the whole row is at fault.',
    nullable: true,
  })
  column: string | null;
}

/** One date of one sampled row, read both ways. */
export class RosterPreviewDateDto {
  @ApiProperty({
    description: 'Which of the three states this date is in.',
    enum: RosterDateResolution,
  })
  resolution: RosterDateResolution;

  @ApiProperty({
    description: 'The local wall-clock time the file wrote.',
    nullable: true,
  })
  local: string | null;

  @ApiProperty({
    description:
      'Every instant it could name. Two of them on the morning a clock went ' +
      'back, and neither is chosen here.',
    type: [String],
  })
  candidates: string[];
}

/** One sampled row, as the importer reads it. */
export class RosterPreviewRowDto {
  @ApiProperty({ description: 'Which line of the file it came from.' })
  line: number;

  @ApiProperty({ description: 'The Character’s name, as exported.' })
  characterName: string;

  @ApiProperty({ description: 'The account handle, as exported.' })
  accountHandle: string;

  @ApiProperty({ description: 'The Character’s level.' })
  level: number;

  @ApiProperty({ description: 'The Class value, exactly as exported.' })
  className: string;

  @ApiProperty({
    description:
      'The profession read out of it, or null when the value names none. ' +
      'The Class text is kept either way.',
    enum: RosterProfession,
    nullable: true,
  })
  profession: RosterProfession | null;

  @ApiProperty({ description: 'The Fleet’s own label for their rank.' })
  guildRank: string;

  @ApiProperty({
    description: 'Their cumulative contribution total. Never a delta.',
  })
  contributionTotal: number;

  @ApiProperty({ description: 'When the game says they joined.' })
  joinedAt: RosterPreviewDateDto;

  @ApiProperty({ description: 'When the game says their rank last changed.' })
  rankChangedAt: RosterPreviewDateDto;

  @ApiProperty({ description: 'When the game last saw them.' })
  lastActiveAt: RosterPreviewDateDto;
}

/**
 * How an export would be read, without reading it into anything.
 *
 * Nothing behind this response is stored. No asset is registered, no bytes are
 * written, no provenance row exists and no scan is requested — the file is
 * read in memory and the buffer is overwritten before the response is built.
 * That is what makes it safe to answer in this much detail: the whole point of
 * the screen it feeds is that somebody can see how their export will be
 * understood *before* deciding to hand it over.
 *
 * The sample it carries is bounded and is the uploader's own file read back to
 * them. It discloses nothing they did not just send, and it is the only honest
 * way to show what choosing the wrong timezone would do, because the
 * difference between a right and a wrong zone is five hours on a date nobody
 * reads carefully.
 */
export class RosterImportPreviewDto {
  @ApiProperty({
    description:
      'Whether this file could be imported as it stands. False while any ' +
      'problem remains, and false while an ambiguous export stamp is ' +
      'unanswered.',
  })
  canImport: boolean;

  @ApiProperty({
    description: 'The timezone every date below was read through.',
  })
  timezone: string;

  @ApiProperty({ description: 'What the filename says.' })
  filename: RosterPreviewFilenameDto;

  @ApiProperty({ description: 'What the file is.' })
  source: RosterPreviewSourceDto;

  @ApiProperty({ description: 'How many rows could be read into values.' })
  readableRowCount: number;

  @ApiProperty({
    description:
      'How many readable rows carry a Class no profession could be read ' +
      'from. Reported rather than refused: the value is kept exactly.',
  })
  unknownClassCount: number;

  @ApiProperty({
    description:
      'How many readable rows carry a date the clock went back over, which ' +
      'stays ambiguous until something resolves it.',
  })
  ambiguousDateCount: number;

  @ApiProperty({
    description: 'Everything that stopped a row being read, in file order.',
    type: [RosterPreviewProblemDto],
  })
  problems: RosterPreviewProblemDto[];

  @ApiProperty({
    description:
      'The first rows of the file as the importer reads them, so that a ' +
      'wrong timezone is visible before it is committed to.',
    type: [RosterPreviewRowDto],
  })
  sample: RosterPreviewRowDto[];
}
