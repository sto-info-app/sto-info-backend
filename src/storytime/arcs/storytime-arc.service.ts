import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { StorytimeArcCollaboratorAccessService } from '../collaboration/storytime-arc-collaborator-access.service';
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { assertImageDescribable } from '../images/storytime-image-alt.utility';
import { StorytimeImageService } from '../images/storytime-image.service';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { CreateArcDto } from './dto/create-arc.dto';
import { UpdateArcDto } from './dto/update-arc.dto';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';

/** Statuses an Arc can hold and still be reachable by the public. */
const PUBLICLY_READABLE_STATUSES = [ArcStatus.PUBLISHED];

/**
 * Visibilities that allow a published Arc to be opened by anyone with a link.
 */
const PUBLICLY_READABLE_VISIBILITIES = [
  StorytimeVisibility.PUBLIC,
  StorytimeVisibility.UNLISTED,
];

/** The artwork an Arc carries. */
export type ArcImageSlot =
  | StorytimeImageSlot.ARC_BANNER
  | StorytimeImageSlot.ARC_PROFILE;

/**
 * Which pair of columns each of an Arc's images occupies.
 *
 * The same shape Stories use, because an Arc is presented to a reader the same
 * way and drifting apart would show up as two banners of different sizes.
 */
const ARC_IMAGE_FIELDS = {
  [StorytimeImageSlot.ARC_BANNER]: {
    id: 'bannerImageId',
    alt: 'bannerImageAlt',
  },
  [StorytimeImageSlot.ARC_PROFILE]: {
    id: 'profileImageId',
    alt: 'profileImageAlt',
  },
} as const satisfies Record<
  ArcImageSlot,
  { id: keyof StorytimeArcEntity; alt: keyof StorytimeArcEntity }
>;

/**
 * Curating an Arc.
 *
 * Anybody may create one, because an Arc is a reading order rather than a
 * claim on anything: it owns none of the Stories in it, and putting one in
 * needs the agreement of whoever wrote it.
 */
@Injectable()
export class StorytimeArcService {
  private readonly _logger = new Logger(StorytimeArcService.name);

  /**
   * Creates an instance of StorytimeArcService.
   *
   * @param _arcRepository - Repository of Arcs.
   * @param _slugService - Produces slugs and remembers retired ones.
   * @param _orderingService - Calculates positions, shared with Stories.
   * @param _markdownService - Renders the Arc description.
   * @param _collaboratorAccessService - Decides what a collaborator may do.
   * @param _imageService - Checks, stores and releases the Arc's artwork.
   */
  constructor(
    @InjectRepository(StorytimeArcEntity)
    private readonly _arcRepository: Repository<StorytimeArcEntity>,
    private readonly _slugService: StorytimeSlugService,
    private readonly _orderingService: StorytimeOrderingService,
    private readonly _markdownService: StorytimeMarkdownService,
    private readonly _collaboratorAccessService: StorytimeArcCollaboratorAccessService,
    private readonly _imageService: StorytimeImageService,
  ) {}

  /**
   * Creates an Arc curated by the caller.
   *
   * @param dto - The Arc to create.
   * @param ownerUserId - The curator.
   * @returns The created Arc.
   */
  async create(
    dto: CreateArcDto,
    ownerUserId: string,
  ): Promise<StorytimeArcEntity> {
    const slug = await this._slugService.generateUniqueSlug({
      desiredSlug: dto.slug,
      title: dto.title,
      targetType: StorytimeTargetType.ARC,
      isTakenByLiveEntity: candidate => this.isSlugTaken(candidate),
    });

    const arc = this._arcRepository.create({
      ...dto,
      slug,
      ownerUserId,
      descriptionHtml: dto.description
        ? this._markdownService.render(dto.description).html
        : null,
      createdByUserId: ownerUserId,
      updatedByUserId: ownerUserId,
    });

    const saved = await this._arcRepository.save(arc);

    this._logger.log(`Arc '${saved.slug}' created by ${ownerUserId}`);

    return saved;
  }

  /**
   * Updates an Arc the caller curates.
   *
   * @param arcId - The Arc.
   * @param dto - The changes, including the version last seen.
   * @param actingUserId - The caller.
   * @returns The updated Arc.
   * @throws ConflictException when the Arc changed since it was loaded.
   */
  async update(
    arcId: string,
    dto: UpdateArcDto,
    actingUserId: string,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.EDIT_ARC,
    );

    if (dto.version !== undefined && dto.version !== arc.version) {
      throw new ConflictException(
        'This Arc has changed since you opened it. Reload and try again.',
      );
    }

    assertImageDescribable(arc.bannerImageId, dto.bannerImageAlt, 'banner');
    assertImageDescribable(
      arc.profileImageId,
      dto.profileImageAlt,
      'profile image',
    );

    const previousSlug = arc.slug;

    if (dto.title !== undefined || dto.slug !== undefined) {
      arc.slug = await this._slugService.generateUniqueSlug({
        desiredSlug: dto.slug,
        title: dto.title ?? arc.title,
        targetType: StorytimeTargetType.ARC,
        isTakenByLiveEntity: candidate => this.isSlugTaken(candidate, arcId),
      });
    }

    const { slug, version, description, ...changes } = dto;
    void slug;
    void version;

    Object.assign(arc, changes);

    if (description !== undefined) {
      arc.description = description;
      arc.descriptionHtml = description
        ? this._markdownService.render(description).html
        : null;
    }

    arc.updatedByUserId = actingUserId;
    arc.version += 1;

    const saved = await this._arcRepository.save(arc);

    await this._slugService.recordRetiredSlug(
      StorytimeTargetType.ARC,
      saved.id,
      previousSlug,
      saved.slug,
    );

    return saved;
  }

  /**
   * Lists the Arcs the caller curates.
   *
   * @param ownerUserId - The curator.
   * @returns Their Arcs.
   */
  findOwnedByUser(ownerUserId: string): Promise<StorytimeArcEntity[]> {
    return this._arcRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Retrieves an Arc the caller curates.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @returns The Arc.
   * @throws NotFoundException when it does not exist.
   * @throws ForbiddenException when the caller does not curate it.
   */
  async findOwnedOrFail(
    arcId: string,
    actingUserId: string,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findOrFail(arcId);

    if (arc.ownerUserId !== actingUserId) {
      throw new ForbiddenException('You do not curate this Arc');
    }

    return arc;
  }

  /**
   * Retrieves an Arc the caller may act on in a particular way.
   *
   * The curator may do anything. Anybody else needs an accepted collaboration
   * granting that specific capability — an invitation nobody has answered, one
   * that was declined, or one since revoked all count for nothing.
   *
   * Publishing has no capability and so cannot be reached through here: only
   * the curator may publish, which is what {@link findOwnedOrFail} is for.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @param capability - What they are trying to do.
   * @returns The Arc.
   * @throws NotFoundException when the Arc does not exist.
   * @throws ForbiddenException when they may not do this to it.
   */
  async findEditableOrFail(
    arcId: string,
    actingUserId: string,
    capability: ArcCapability,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findOrFail(arcId);

    if (arc.ownerUserId === actingUserId) {
      return arc;
    }

    const permitted = await this._collaboratorAccessService.hasCapability(
      arcId,
      actingUserId,
      capability,
    );

    if (!permitted) {
      throw new ForbiddenException(
        'You do not have permission to do that to this Arc',
      );
    }

    return arc;
  }

  /**
   * Retrieves an Arc the caller has any working access to.
   *
   * Deliberately broader than a single capability, for the same reason as
   * Stories: somebody invited only to chase up Story owners still has to open
   * the Arc to do it.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @returns The Arc.
   * @throws ForbiddenException when they have no access to it at all.
   */
  async findAccessibleOrFail(
    arcId: string,
    actingUserId: string,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findOrFail(arcId);

    if (arc.ownerUserId === actingUserId) {
      return arc;
    }

    const collaboration = await this._collaboratorAccessService.findAccepted(
      arcId,
      actingUserId,
    );

    if (!collaboration) {
      throw new ForbiddenException('You do not have access to this Arc');
    }

    return arc;
  }

  /**
   * Lists the Arcs somebody curates or helps with.
   *
   * @param userId - The person.
   * @param collaboratingArcIds - Arcs they have accepted a collaboration on.
   * @returns The Arcs they can work on.
   */
  findWorkableByUser(
    userId: string,
    collaboratingArcIds: string[],
  ): Promise<StorytimeArcEntity[]> {
    return this._arcRepository.find({
      where:
        collaboratingArcIds.length > 0
          ? [{ ownerUserId: userId }, { id: In(collaboratingArcIds) }]
          : { ownerUserId: userId },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Loads an Arc, or fails.
   *
   * @param arcId - The Arc.
   * @returns The Arc.
   * @throws NotFoundException when it does not exist.
   */
  private async findOrFail(arcId: string): Promise<StorytimeArcEntity> {
    const arc = await this._arcRepository.findOne({ where: { id: arcId } });

    if (!arc) {
      throw new NotFoundException('Arc not found');
    }

    return arc;
  }

  /**
   * Finds an Arc by slug for public reading.
   *
   * @param slug - The Arc slug.
   * @returns The Arc, or null when nothing public matches.
   */
  async findPublicBySlug(slug: string): Promise<StorytimeArcEntity | null> {
    const arc = await this._arcRepository.findOne({ where: { slug } });

    // A reader who followed a link to an Arc that has since been taken down is
    // told so, rather than that it never existed. Only for Arcs that were
    // public: saying "removed" about a draft would confirm it exists.
    if (
      arc &&
      PUBLICLY_READABLE_STATUSES.includes(arc.status) &&
      arc.visibility === StorytimeVisibility.PUBLIC &&
      arc.moderationStatus === StorytimeModerationStatus.REMOVED
    ) {
      throw new GoneException('This Arc has been removed by an administrator.');
    }

    if (!arc || !this.isPubliclyReadable(arc)) {
      return null;
    }

    return arc;
  }

  /**
   * Lists publicly readable Arcs.
   *
   * Unlisted Arcs are excluded, exactly as they are for Stories: that is the
   * whole difference between unlisted and public.
   *
   * @returns The Arcs anybody may discover, newest first.
   */
  findPublic(): Promise<StorytimeArcEntity[]> {
    return this._arcRepository.find({
      where: {
        status: In(PUBLICLY_READABLE_STATUSES),
        visibility: StorytimeVisibility.PUBLIC,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
      order: { publishedAt: 'DESC' },
    });
  }

  /**
   * Lists the publicly readable Arcs one member curates.
   *
   * @param ownerUserId - The curator.
   * @returns Their public Arcs, newest first.
   */
  findPublicByOwner(ownerUserId: string): Promise<StorytimeArcEntity[]> {
    return this._arcRepository.find({
      where: {
        ownerUserId,
        status: In(PUBLICLY_READABLE_STATUSES),
        visibility: StorytimeVisibility.PUBLIC,
        moderationStatus: StorytimeModerationStatus.ACTIVE,
      },
      order: { publishedAt: 'DESC' },
    });
  }

  /**
   * Finds several Arcs by identifier for public reading.
   *
   * @param arcIds - The Arcs to find.
   * @returns The readable Arcs among them.
   */
  async findPublicByIds(arcIds: string[]): Promise<StorytimeArcEntity[]> {
    if (arcIds.length === 0) {
      return [];
    }

    const arcs = await this._arcRepository.find({
      where: { id: In(arcIds) },
    });

    return arcs.filter(arc => this.isPubliclyReadable(arc));
  }

  /**
   * Publishes an Arc.
   *
   * An Arc with nothing agreed in it is refused: publishing one would promise
   * a reading order and then show an empty page.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @param approvedStoryCount - How many Stories have agreed to be in it.
   * @returns The published Arc.
   * @throws BadRequestException when nothing has agreed to be in it.
   */
  async publish(
    arcId: string,
    actingUserId: string,
    approvedStoryCount: number,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findOwnedOrFail(arcId, actingUserId);

    if (approvedStoryCount === 0) {
      throw new BadRequestException(
        'An Arc needs at least one Story that has agreed to be in it before it can be published.',
      );
    }

    if (arc.status === ArcStatus.PUBLISHED) {
      return arc;
    }

    arc.status = ArcStatus.PUBLISHED;
    arc.publishedAt = arc.publishedAt ?? new Date();
    arc.updatedByUserId = actingUserId;
    arc.version += 1;

    this._logger.log(`Arc '${arc.slug}' published by ${actingUserId}`);

    return this._arcRepository.save(arc);
  }

  /**
   * Withdraws an Arc from publication.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @returns The unpublished Arc.
   */
  async unpublish(
    arcId: string,
    actingUserId: string,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findOwnedOrFail(arcId, actingUserId);

    arc.status = ArcStatus.UNPUBLISHED;
    arc.updatedByUserId = actingUserId;
    arc.version += 1;

    return this._arcRepository.save(arc);
  }

  /**
   * Deletes an Arc.
   *
   * Soft-deleted, so its memberships survive as a record of what was agreed
   * and the slug is not immediately reissued.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   */
  async remove(arcId: string, actingUserId: string): Promise<void> {
    const arc = await this.findOwnedOrFail(arcId, actingUserId);

    arc.deletedByUserId = actingUserId;
    await this._arcRepository.save(arc);
    await this._arcRepository.softDelete(arcId);
  }

  /**
   * Replaces one of an Arc's images.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @param slot - Which image is being set.
   * @param file - The cropped upload.
   * @param altText - What the image shows.
   * @returns The Arc, carrying its new artwork.
   * @throws ForbiddenException when the caller may not edit this Arc.
   * @throws BadRequestException when the upload is not usable for the slot.
   */
  async setImage(
    arcId: string,
    actingUserId: string,
    slot: ArcImageSlot,
    file: Express.Multer.File,
    altText: string,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.EDIT_ARC,
    );

    const fields = ARC_IMAGE_FIELDS[slot];
    const replacedImageId = arc[fields.id];

    arc[fields.id] = await this._imageService.store({
      slot,
      userId: actingUserId,
      entityId: arcId,
      file,
    });
    arc[fields.alt] = altText;
    arc.updatedByUserId = actingUserId;
    arc.version += 1;

    const saved = await this._arcRepository.save(arc);

    // Released only once the Arc points at the new image, so a failed save
    // leaves an unreferenced image rather than an Arc referencing nothing.
    await this._imageService.release(replacedImageId);

    return saved;
  }

  /**
   * Takes one of an Arc's images away, along with its description.
   *
   * @param arcId - The Arc.
   * @param actingUserId - The caller.
   * @param slot - Which image is being removed.
   * @returns The Arc, without that artwork.
   * @throws ForbiddenException when the caller may not edit this Arc.
   */
  async clearImage(
    arcId: string,
    actingUserId: string,
    slot: ArcImageSlot,
  ): Promise<StorytimeArcEntity> {
    const arc = await this.findEditableOrFail(
      arcId,
      actingUserId,
      ArcCapability.EDIT_ARC,
    );

    const fields = ARC_IMAGE_FIELDS[slot];
    const removedImageId = arc[fields.id];

    arc[fields.id] = null;
    arc[fields.alt] = null;
    arc.updatedByUserId = actingUserId;
    arc.version += 1;

    const saved = await this._arcRepository.save(arc);

    await this._imageService.release(removedImageId);

    return saved;
  }

  /**
   * Works out where a new Story joins an Arc's reading order.
   *
   * @param highestExistingIndex - The last position in use, if any.
   * @returns The order index for the new membership.
   */
  nextOrderIndex(highestExistingIndex: number | null): number {
    return this._orderingService.nextIndex(highestExistingIndex);
  }

  /**
   * Reports whether an Arc is reachable by the public.
   *
   * @param arc - The Arc.
   * @returns True when anybody holding a link may open it.
   */
  private isPubliclyReadable(arc: StorytimeArcEntity): boolean {
    return (
      PUBLICLY_READABLE_STATUSES.includes(arc.status) &&
      PUBLICLY_READABLE_VISIBILITIES.includes(arc.visibility) &&
      arc.moderationStatus === StorytimeModerationStatus.ACTIVE
    );
  }

  /**
   * Reports whether a slug is already used by a live Arc.
   *
   * @param slug - The candidate slug.
   * @param exceptArcId - An Arc to ignore, when renaming it.
   * @returns True when the slug is taken.
   */
  private async isSlugTaken(
    slug: string,
    exceptArcId?: string,
  ): Promise<boolean> {
    const count = await this._arcRepository.count({
      where: {
        slug,
        deletedAt: IsNull(),
        ...(exceptArcId ? { id: Not(exceptArcId) } : {}),
      },
    });

    return count > 0;
  }
}
