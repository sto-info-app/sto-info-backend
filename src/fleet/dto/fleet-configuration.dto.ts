import { ApiProperty } from '@nestjs/swagger';

/**
 * Which parts of Fleet Community are currently switched on.
 */
export class FleetFeatureStateDto {
  @ApiProperty({
    description: 'Whether Fleet Community is switched on at all.',
  })
  isEnabled: boolean;

  @ApiProperty({
    description: 'Whether a Community, Fleet or Armada may be registered.',
  })
  registrationEnabled: boolean;

  @ApiProperty({ description: 'Whether roster CSV imports may be submitted.' })
  importsEnabled: boolean;

  @ApiProperty({
    description: 'Whether scoped chat channels and direct messages are served.',
  })
  chatEnabled: boolean;
}

/**
 * The published access and retention figures, as the client states them.
 */
export class FleetPolicyDto {
  @ApiProperty({
    description: 'How far back ordinary chat history may be read, in hours.',
    example: 4,
  })
  chatMemberHistoryHours: number;

  @ApiProperty({
    description: 'How far back a scope admin may export a transcript, in days.',
    example: 7,
  })
  chatTranscriptHistoryDays: number;

  @ApiProperty({
    description: 'How many custom channels one scope may have, at each level.',
    example: 3,
  })
  customChannelLimit: number;

  @ApiProperty({
    description: 'How long ordinary chat messages are retained, in days.',
    example: 45,
  })
  chatRetentionDays: number;

  @ApiProperty({
    description: 'How long a sanitised import source is retained, in days.',
    example: 180,
  })
  importSourceRetentionDays: number;
}

/**
 * What the client needs to render Fleet Community consistently with the server.
 */
export class FleetConfigurationDto {
  @ApiProperty({ type: FleetFeatureStateDto })
  features: FleetFeatureStateDto;

  @ApiProperty({ type: FleetPolicyDto })
  policy: FleetPolicyDto;
}
