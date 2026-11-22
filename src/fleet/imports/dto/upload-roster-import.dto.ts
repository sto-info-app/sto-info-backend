import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsISO8601, IsOptional, IsString, Validate } from 'class-validator';

import { IsIanaTimezoneConstraint } from 'src/shared/utilities/is-iana-timezone.constraint';

/**
 * What has to arrive alongside an export before it can be imported.
 *
 * The same timezone the preview asked for, and for the same reason: the file
 * writes wall-clock times and does not say whose clock they were. It is not
 * carried over from the preview, because the preview stored nothing and there
 * is nothing to carry it in — and a second statement of the same answer is
 * also a second chance to notice it is wrong.
 */
export class UploadRosterImportDto {
  @ApiProperty({
    description:
      'The IANA timezone the exporting player’s own clock was set to, ' +
      'such as Europe/London.',
    example: 'Europe/London',
  })
  @IsString()
  @Validate(IsIanaTimezoneConstraint)
  timezone: string;

  @ApiPropertyOptional({
    description:
      'Which moment the filename stamp names, for the one morning a year ' +
      'it names two. Required only when the preview said the clock went ' +
      'back over that hour, and refused unless it is one of the two ' +
      'candidates the preview returned — an export instant decides the ' +
      'order of a Fleet’s history, so it is checked rather than ' +
      'believed.',
    example: '2026-10-25T00:30:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  exportedAt?: string;
}
