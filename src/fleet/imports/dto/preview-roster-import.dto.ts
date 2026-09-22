import { ApiProperty } from '@nestjs/swagger';

import { IsString, Validate } from 'class-validator';

import { IsIanaTimezoneConstraint } from 'src/shared/utilities/is-iana-timezone.constraint';

/**
 * What has to arrive alongside an export before anything can be read from it.
 *
 * One field, and it is not optional. An STO export writes wall-clock times
 * with no zone attached, in the filename and in every date column, so without
 * this the file says when something happened only to whoever already knows
 * where the exporter was sitting. Guessing — the server's zone, the Fleet's,
 * the last import's — would be guessing on somebody else's behalf about
 * somebody else's roster.
 */
export class PreviewRosterImportDto {
  @ApiProperty({
    description:
      'The IANA timezone the exporting player’s own clock was set to, ' +
      'such as Europe/London. Applied to the filename stamp and to every ' +
      'date in the file, each against the rules in force on its own date.',
    example: 'Europe/London',
  })
  @IsString()
  @Validate(IsIanaTimezoneConstraint)
  timezone: string;
}
