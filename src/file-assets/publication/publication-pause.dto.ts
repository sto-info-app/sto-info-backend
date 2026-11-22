import { ApiProperty } from '@nestjs/swagger';

/**
 * Whether publication of scanned uploads is paused (FC-042), for the Admin
 * page and Scan Diagnostics.
 */
export class PublicationPauseDto {
  @ApiProperty({
    description:
      'Whether publication is paused. Uploads are still accepted and ' +
      'scanned; nothing is published until it is resumed.',
  })
  paused: boolean;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When it was paused; null while it runs.',
  })
  pausedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The site admin who paused it; null while it runs.',
  })
  pausedByUserId: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'That site admin’s username; null while it runs, or when their ' +
      'account has gone.',
  })
  pausedByUsername: string | null;

  @ApiProperty({
    nullable: true,
    type: Boolean,
    description:
      'Whether the publication queue itself is paused now, or null when ' +
      'Redis cannot be reached or does not answer within 5 seconds. The ' +
      'switch is the authority: paused with this null, the queue is paused ' +
      'at the first minute’s run once Redis answers, and until then no job ' +
      'is published.',
  })
  queuePaused: boolean | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Cleared uploads waiting to be published, or null when Redis cannot ' +
      'be reached or does not answer within 5 seconds.',
  })
  held: number | null;
}
