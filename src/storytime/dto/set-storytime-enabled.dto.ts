import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';

/**
 * Switches Storytime on or off at runtime, with a reason for the site admin
 * log (FC-045).
 */
export class SetStorytimeEnabledDto extends AdminReasonDto {
  @ApiProperty({
    description:
      'Whether Storytime should be available. Disabling hides every Storytime route and removes it from navigation.',
  })
  @IsBoolean()
  readonly isEnabled: boolean;
}
