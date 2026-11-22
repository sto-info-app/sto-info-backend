import { ApiProperty } from '@nestjs/swagger';

import { RosterImportActionDto } from './roster-import-action.dto';
import { RosterPreviewProblemDto } from './roster-import-preview.dto';
import { RosterImportSourceDto } from './roster-import-source.dto';

/**
 * One import, with what only an investigator is shown.
 *
 * Both extra fields are null for anybody without `roster.investigate`, and
 * that is different from empty: null says "not yours to see", an empty list
 * says "there is nothing". A listing never carries either; it is read by more
 * people, more often, and the problems of a two-thousand-row export can be
 * most of two thousand rows.
 *
 * The problems are a line, a column and a code, exactly as the preview and
 * the upload report them. Never a value: the file they came from is in
 * quarantine, and reading it is FC-037's to authorise.
 */
export class RosterImportDetailDto extends RosterImportSourceDto {
  @ApiProperty({
    description:
      'Every row problem that stopped it being read. Null unless the caller ' +
      'investigates imports.',
    type: [RosterPreviewProblemDto],
    nullable: true,
  })
  problems: RosterPreviewProblemDto[] | null;

  @ApiProperty({
    description:
      'The other imports claiming the same moment, oldest first; the first ' +
      'of them that was not refused is the version in force. Empty when ' +
      'nothing disagrees. Null unless the caller investigates imports.',
    type: [RosterImportSourceDto],
    nullable: true,
  })
  conflictMembers: RosterImportSourceDto[] | null;

  @ApiProperty({
    description:
      'The export selected as the roster at this moment, when its conflict ' +
      'group has a selection; otherwise null. Null unless the caller ' +
      'investigates imports.',
    nullable: true,
  })
  selectedImportId: string | null;

  @ApiProperty({
    description:
      'The lines of the rows an investigator has excluded, in order. Null ' +
      'unless the caller investigates imports.',
    type: [Number],
    nullable: true,
  })
  excludedLines: number[] | null;

  @ApiProperty({
    description:
      'Every correction made to it, newest first. Null unless the caller ' +
      'investigates imports.',
    type: [RosterImportActionDto],
    nullable: true,
  })
  actions: RosterImportActionDto[] | null;
}
