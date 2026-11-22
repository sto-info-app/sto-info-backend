import { ApiProperty } from '@nestjs/swagger';

import { Column } from 'typeorm';

import { buildCloudflareImageUrl } from '../../../shared/constants/image.constants';
import { StorytimeModeratedEntity } from './storytime-moderated.entity';

/**
 * A creator's work — a Story, an Arc, a Chapter or a Character — with what a
 * removal leaves to be undone and an optimistic-concurrency version.
 *
 * A work is restored as well as removed, and remembers who soft-deleted it;
 * every edit carries the version the editor last saw, so a stale write is
 * refused rather than silently overwriting somebody else's.
 */
export abstract class StorytimeWorkEntity extends StorytimeModeratedEntity {
  @ApiProperty({ description: 'When it was restored.', nullable: true })
  @Column({ type: 'timestamp', nullable: true, default: null })
  restoredAt: Date | null;

  @ApiProperty({
    description: 'Administrator who restored it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  restoredByUserId: string | null;

  @ApiProperty({
    description: 'User who soft-deleted it.',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true, default: null })
  deletedByUserId: string | null;

  @ApiProperty({
    description:
      'Optimistic-concurrency version, sent back on update so a stale edit is refused.',
  })
  @Column({ type: 'integer', nullable: false, default: 1 })
  version: number;

  /**
   * Builds a Cloudflare Images URL for a stored image ID.
   *
   * Returns null rather than a placeholder when there is no image: Storytime
   * artwork is optional throughout, and a missing image must render as nothing
   * at all rather than as an empty frame.
   *
   * @param imageId - The stored Cloudflare Images ID.
   * @param variant - The variant to request.
   * @returns The image URL, or null when no image is set.
   */
  protected buildImageUrl(
    imageId: string | null,
    variant: string,
  ): string | null {
    if (!imageId) {
      return null;
    }

    return buildCloudflareImageUrl(imageId, variant);
  }
}
