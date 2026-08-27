import { Injectable } from '@nestjs/common';
import { TagDto } from './dto/create-tag.dto';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';

/**
 * Turns tags into the shape the API returns.
 *
 * One shape for everybody. A tag has nothing private about it: who added it
 * and when matters to an administrator reading the audit trail, not to
 * anything that renders a filter link.
 */
@Injectable()
export class StorytimeTagMapper {
  /**
   * Maps a tag.
   *
   * @param tag - The tag entity.
   * @returns The tag.
   */
  toTag(tag: StorytimeTagEntity): TagDto {
    return {
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      description: tag.description,
      category: tag.category,
      displayOrder: tag.displayOrder,
    };
  }

  /**
   * Maps several tags.
   *
   * @param tags - The tag entities.
   * @returns The tags.
   */
  toList(tags: StorytimeTagEntity[]): TagDto[] {
    return tags.map(tag => this.toTag(tag));
  }
}
