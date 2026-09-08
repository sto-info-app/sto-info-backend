import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { normaliseToSlug } from '../../shared/utilities/slug.utility';
import { StorytimeTagCategory } from '../enums/storytime-tag-category.enum';
import { CreateTagDto, UpdateTagDto } from './dto/create-tag.dto';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';

/**
 * The Storytime tag vocabulary.
 *
 * Administrators own it. A creator picks from the list; nobody types a new
 * term into a Story and hopes somebody else spells it the same way, which is
 * the failure that makes tag filters worthless everywhere they are free text.
 */
@Injectable()
export class StorytimeTagService {
  private readonly _logger = new Logger(StorytimeTagService.name);

  /**
   * Creates an instance of StorytimeTagService.
   *
   * @param _tagRepository - Repository of tags.
   */
  constructor(
    @InjectRepository(StorytimeTagEntity)
    private readonly _tagRepository: Repository<StorytimeTagEntity>,
  ) {}

  /**
   * Lists the whole vocabulary, grouped the way a picker shows it.
   *
   * @param category - The category to limit to, if any.
   * @returns The tags, by category and then in the order set for each.
   */
  findAll(category?: StorytimeTagCategory): Promise<StorytimeTagEntity[]> {
    return this._tagRepository.find({
      where: category ? { category } : {},
      order: { category: 'ASC', displayOrder: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Finds several tags by identifier.
   *
   * @param tagIds - The tags wanted.
   * @returns The tags that exist.
   */
  findByIds(tagIds: string[]): Promise<StorytimeTagEntity[]> {
    if (tagIds.length === 0) {
      return Promise.resolve([]);
    }

    return this._tagRepository.find({ where: { id: In(tagIds) } });
  }

  /**
   * Retrieves one tag.
   *
   * @param tagId - The tag.
   * @returns The tag.
   * @throws NotFoundException when no live tag has that identifier.
   */
  async findOneOrFail(tagId: string): Promise<StorytimeTagEntity> {
    const tag = await this._tagRepository.findOne({ where: { id: tagId } });

    if (!tag) {
      throw new NotFoundException('That tag could not be found.');
    }

    return tag;
  }

  /**
   * Adds a tag to the vocabulary.
   *
   * @param dto - The tag to add.
   * @param actingUserId - The administrator.
   * @returns The tag.
   */
  async create(
    dto: CreateTagDto,
    actingUserId: string,
  ): Promise<StorytimeTagEntity> {
    const slug = normaliseToSlug(dto.slug ?? dto.name);

    await this.assertSlugFree(slug);

    const tag = await this._tagRepository.save(
      this._tagRepository.create({
        slug,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category,
        displayOrder: dto.displayOrder ?? 0,
        isAdminManaged: true,
        createdByUserId: actingUserId,
        updatedByUserId: actingUserId,
      }),
    );

    this._logger.log(`Tag '${tag.slug}' created by ${actingUserId}`);

    return tag;
  }

  /**
   * Changes a tag.
   *
   * Renaming is allowed; the slug only changes when an administrator asks for
   * it, because a tag's address turns up in filter links people have shared.
   *
   * @param tagId - The tag.
   * @param dto - The changes.
   * @param actingUserId - The administrator.
   * @returns The tag after the change.
   */
  async update(
    tagId: string,
    dto: UpdateTagDto,
    actingUserId: string,
  ): Promise<StorytimeTagEntity> {
    const tag = await this.findOneOrFail(tagId);

    if (dto.slug) {
      const slug = normaliseToSlug(dto.slug);

      await this.assertSlugFree(slug, tagId);
      tag.slug = slug;
    }

    tag.name = dto.name ?? tag.name;
    tag.description =
      dto.description === undefined
        ? tag.description
        : (dto.description ?? null);
    tag.category = dto.category ?? tag.category;
    tag.displayOrder = dto.displayOrder ?? tag.displayOrder;
    tag.updatedByUserId = actingUserId;

    return this._tagRepository.save(tag);
  }

  /**
   * Removes a tag from the vocabulary.
   *
   * Soft-deleted, and the join rows go with it by foreign key: a tag nobody
   * should use again should stop appearing on the Stories that used it, rather
   * than lingering as a filter that finds them.
   *
   * @param tagId - The tag.
   * @param actingUserId - The administrator.
   */
  async remove(tagId: string, actingUserId: string): Promise<void> {
    const tag = await this.findOneOrFail(tagId);

    await this._tagRepository.softDelete(tag.id);

    this._logger.log(`Tag '${tag.slug}' deleted by ${actingUserId}`);
  }

  /**
   * Refuses a slug another live tag already holds.
   *
   * @param slug - The candidate slug.
   * @param exceptId - A tag allowed to keep its own slug.
   * @throws BadRequestException when something else holds it.
   */
  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const existing = await this._tagRepository.findOne({ where: { slug } });

    if (existing && existing.id !== exceptId) {
      throw new BadRequestException(`The tag '${slug}' already exists.`);
    }
  }
}
