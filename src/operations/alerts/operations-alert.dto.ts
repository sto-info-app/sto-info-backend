import { ApiProperty } from '@nestjs/swagger';

import { OperationsAlertKind } from './operations-alert.enum';

/** An operations problem that is open now (FC-042), for Scan Diagnostics. */
export class OperationsAlertDto {
  @ApiProperty({ enum: OperationsAlertKind })
  kind: OperationsAlertKind;

  @ApiProperty({ description: 'When the problem was first seen.' })
  openedAt: Date;

  @ApiProperty({ description: 'When the alert run last saw it.' })
  lastSeenAt: Date;

  @ApiProperty({
    description:
      'Counts and ages as last seen: minutes waited, workers paused, ' +
      'failed jobs and the like. Never a name or an error’s text.',
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  detail: Record<string, number>;
}
