import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

/**
 * Switches Storytime on or off at runtime.
 */
export class SetStorytimeEnabledDto {
  @ApiProperty({
    description:
      'Whether Storytime should be available. Disabling hides every Storytime route and removes it from navigation.',
  })
  @IsBoolean()
  readonly isEnabled: boolean;
}
