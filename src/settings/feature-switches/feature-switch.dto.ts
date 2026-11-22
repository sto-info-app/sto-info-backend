import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean } from 'class-validator';

import { AdminReasonDto } from 'src/shared/dto/admin-reason.dto';

import { FeatureSwitch } from './feature-switch.constants';

/** One of a feature's capability flags, which the environment sets. */
export class FeatureSubFlagDto {
  @ApiProperty({
    description: 'The environment variable that sets it.',
    example: 'FLEET_CHAT_ENABLED',
  })
  key: string;

  @ApiProperty({ description: 'What it lets people do, in words.' })
  label: string;

  @ApiProperty({
    description:
      'Whether the environment allows it. Unset counts as allowed; only ' +
      '"false" turns it off. It takes effect only while the feature is on.',
  })
  isEnabled: boolean;
}

/** A feature's master switch, for the Admin page (FC-045). */
export class FeatureSwitchDto {
  @ApiProperty({ enum: FeatureSwitch })
  feature: FeatureSwitch;

  @ApiProperty({ description: 'The feature’s name.' })
  label: string;

  @ApiProperty({
    description:
      'Whether the feature is switched on. Every instance sees a change ' +
      'within ten seconds.',
  })
  isEnabled: boolean;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When the switch was last written; null when it is missing.',
  })
  changedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The username of whoever last changed it; null when it was set by a ' +
      'migration or by hand, or their account has gone.',
  })
  changedByUsername: string | null;

  @ApiProperty({ type: [FeatureSubFlagDto] })
  subFlags: FeatureSubFlagDto[];
}

/** Switches a feature on or off, with a reason for the site admin log. */
export class SetFeatureSwitchDto extends AdminReasonDto {
  @ApiProperty({
    description:
      'Whether the feature should be on. Off hides every route and page it ' +
      'has, as though it did not exist; nothing it holds is deleted.',
  })
  @IsBoolean()
  readonly isEnabled: boolean;
}
