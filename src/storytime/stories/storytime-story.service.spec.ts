import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LimitService } from '../../access-control/limit.service';
import { StorytimeCollaboratorAccessService } from '../collaboration/storytime-collaborator-access.service';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { STORYTIME_POLICY_VERSION } from '../constants/storytime-policy.constants';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { StoryStatus } from '../enums/story-status.enum';
import { StorytimeActivityType } from '../enums/storytime-activity-type.enum';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeImageService } from '../images/storytime-image.service';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import {
  SlugRequest,
  StorytimeSlugService,
} from '../shared/storytime-slug.service';
import { StorytimeActivityFeedService } from '../social/storytime-activity-feed.service';
import { StorySort } from './dto/story-query.dto';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';
import { StorytimeStoryService } from './storytime-story.service';

/** Chainable stub standing in for a TypeORM query builder. */
interface QueryBuilderStub {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  getManyAndCount: jest.Mock;
}

describe('StorytimeStoryService', () => {
  let service: StorytimeStoryService;
  let storyRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
    findByRetiredSlug: jest.Mock;
  };
  let limitService: { assertWithinLimit: jest.Mock };
  let feedService: { recordQuietly: jest.Mock };
  let collaboratorAccessService: {
    hasCapability: jest.Mock;
    findAccepted: jest.Mock;
  };
  let queryBuilder: QueryBuilderStub;
  let imageService: {
    store: jest.Mock;
    release: jest.Mock;
  };

  const ownerId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const otherUserId = 'e6d3a1b2-0000-4000-8000-000000000002';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';

  /**
   * Builds a Story with sensible defaults for the test at hand.
   *
   * @param overrides - Fields to change.
   * @returns The Story entity.
   */
  const buildStory = (
    overrides: Partial<StorytimeStoryEntity> = {},
  ): StorytimeStoryEntity => {
    const story = new StorytimeStoryEntity();
    Object.assign(story, {
      id: storyId,
      ownerUserId: ownerId,
      title: 'The Long Way Home',
      slug: 'the-long-way-home',
      shortDescription: 'A summary',
      description: null,
      descriptionHtml: null,
      status: StoryStatus.DRAFT,
      visibility: StorytimeVisibility.PRIVATE,
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      bannerImageId: null,
      bannerImageAlt: null,
      profileImageId: null,
      profileImageAlt: null,
      ownerOrderIndex: 1000,
      publishedChapterCount: 1,
      contentPolicyAcceptedAt: new Date(),
      contentPolicyVersion: STORYTIME_POLICY_VERSION,
      upVoteCount: 0,
      downVoteCount: 0,
      version: 1,
      publishedAt: null,
      ...overrides,
    });
    return story;
  };

  beforeEach(async () => {
    // The upload pipeline is stubbed: what a real Cloudflare call would do is
    // its own service's business, and these tests are about what the work
    // records afterwards.
    imageService = {
      store: jest.fn().mockResolvedValue('stored-image-id'),
      release: jest.fn().mockResolvedValue(undefined),
    };

    queryBuilder = {
      where: jest.fn((): QueryBuilderStub => queryBuilder),
      andWhere: jest.fn((): QueryBuilderStub => queryBuilder),
      orderBy: jest.fn((): QueryBuilderStub => queryBuilder),
      skip: jest.fn((): QueryBuilderStub => queryBuilder),
      take: jest.fn((): QueryBuilderStub => queryBuilder),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    storyRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeStoryEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
      softDelete: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    slugService = {
      // Invokes the availability callback the service supplies, the way the
      // real slug service does. Without that the callback — and the query
      // behind it — would never run in these tests.
      generateUniqueSlug: jest.fn(async (request: SlugRequest) => {
        await request.isTakenByLiveEntity('candidate-slug');
        return 'the-long-way-home';
      }),
      recordRetiredSlug: jest.fn().mockResolvedValue(undefined),
      findByRetiredSlug: jest.fn().mockResolvedValue(null),
    };

    limitService = {
      assertWithinLimit: jest.fn().mockResolvedValue(undefined),
    };

    // Nobody collaborates unless a test says so, so every existing expectation
    // still describes the owner acting alone.
    collaboratorAccessService = {
      hasCapability: jest.fn().mockResolvedValue(false),
      findAccepted: jest.fn().mockResolvedValue(null),
    };
    feedService = { recordQuietly: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeStoryService,
        {
          provide: getRepositoryToken(StorytimeStoryEntity),
          useValue: storyRepository,
        },
        { provide: StorytimeSlugService, useValue: slugService },
        StorytimeOrderingService,
        StorytimeMarkdownService,
        { provide: LimitService, useValue: limitService },
        {
          provide: StorytimeCollaboratorAccessService,
          useValue: collaboratorAccessService,
        },
        { provide: StorytimeActivityFeedService, useValue: feedService },
        { provide: StorytimeImageService, useValue: imageService },
      ],
    }).compile();

    service = module.get<StorytimeStoryService>(StorytimeStoryService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a Story owned by the caller', async () => {
      const created = await service.create({ title: 'A Story' }, ownerId);

      expect(created.ownerUserId).toBe(ownerId);
      expect(created.createdByUserId).toBe(ownerId);
      expect(created.updatedByUserId).toBe(ownerId);
    });

    it('places the first Story at the start of the collection', async () => {
      const created = await service.create({ title: 'A Story' }, ownerId);

      expect(created.ownerOrderIndex).toBe(1000);
    });

    it('places a later Story after the last', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ ownerOrderIndex: 3000 }),
      );

      const created = await service.create({ title: 'A Story' }, ownerId);

      expect(created.ownerOrderIndex).toBe(4000);
    });

    it('renders the description to sanitised HTML', async () => {
      const created = await service.create(
        { title: 'A Story', description: '# Heading' },
        ownerId,
      );

      expect(created.descriptionHtml).toContain('<h2');
    });

    it('leaves rendered HTML empty when there is no description', async () => {
      const created = await service.create({ title: 'A Story' }, ownerId);

      expect(created.descriptionHtml).toBeNull();
    });

    it('refuses when the caller is at their Story limit', async () => {
      limitService.assertWithinLimit.mockRejectedValue(
        new ForbiddenException('limit'),
      );

      await expect(
        service.create({ title: 'A Story' }, ownerId),
      ).rejects.toThrow(ForbiddenException);
    });

    // The curated list is the same one the client is served, so a mismatch
    // would produce a Story nothing can filter by.
    it('refuses a language that is not offered', async () => {
      await expect(
        service.create({ title: 'A Story', languageCode: 'xx' }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an offered language', async () => {
      const created = await service.create(
        { title: 'A Story', languageCode: 'tlh' },
        ownerId,
      );

      expect(created.languageCode).toBe('tlh');
    });
  });

  describe('slug availability', () => {
    /**
     * Runs the availability callback the service handed to the slug service.
     *
     * @returns Whether the candidate was reported as taken.
     */
    const runAvailabilityCallback = async (): Promise<boolean> => {
      const request = slugService.generateUniqueSlug.mock
        .calls[0][0] as SlugRequest;
      return request.isTakenByLiveEntity('candidate-slug');
    };

    it('reports a slug as free when no live Story holds it', async () => {
      await service.create({ title: 'A Story' }, ownerId);

      await expect(runAvailabilityCallback()).resolves.toBe(false);
    });

    it('reports a slug as taken when a live Story holds it', async () => {
      await service.create({ title: 'A Story' }, ownerId);
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(runAvailabilityCallback()).resolves.toBe(true);
    });

    it('ignores soft-deleted Stories when testing availability', async () => {
      await service.create({ title: 'A Story' }, ownerId);

      expect(storyRepository.findOne).toHaveBeenCalledWith({
        where: { slug: 'candidate-slug', deletedAt: expect.anything() },
      });
    });

    // A Story renaming itself must not collide with the slug it already has.
    it('lets a Story keep its own slug when renaming', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());
      await service.update(storyId, { title: 'A New Title' }, ownerId);

      const request = slugService.generateUniqueSlug.mock
        .calls[0][0] as SlugRequest;
      await request.isTakenByLiveEntity('candidate-slug');

      expect(storyRepository.findOne).toHaveBeenCalledWith({
        where: {
          slug: 'candidate-slug',
          id: expect.anything(),
          deletedAt: expect.anything(),
        },
      });
    });
  });

  describe('findOwnedOrFail', () => {
    it('returns a Story the caller owns', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.findOwnedOrFail(storyId, ownerId),
      ).resolves.toBeDefined();
    });

    it('throws when the Story does not exist', async () => {
      await expect(service.findOwnedOrFail(storyId, ownerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    // A request can name any Story, so ownership is checked against the
    // stored row rather than trusted from the caller.
    it('throws when the caller does not own the Story', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.findOwnedOrFail(storyId, otherUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      storyRepository.findOne.mockResolvedValue(buildStory());
    });

    it('applies the supplied changes', async () => {
      const updated = await service.update(
        storyId,
        { shortDescription: 'Changed' },
        ownerId,
      );

      expect(updated.shortDescription).toBe('Changed');
      expect(updated.updatedByUserId).toBe(ownerId);
    });

    it('advances the version', async () => {
      const updated = await service.update(storyId, { title: 'New' }, ownerId);

      expect(updated.version).toBe(2);
    });

    it('rejects an update made from a stale copy', async () => {
      await expect(
        service.update(storyId, { title: 'New', version: 0 }, ownerId),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts an update carrying the current version', async () => {
      await expect(
        service.update(storyId, { title: 'New', version: 1 }, ownerId),
      ).resolves.toBeDefined();
    });

    it('accepts an update that omits the version', async () => {
      await expect(
        service.update(storyId, { title: 'New' }, ownerId),
      ).resolves.toBeDefined();
    });

    it('regenerates the rendered description', async () => {
      const updated = await service.update(
        storyId,
        { description: '**bold**' },
        ownerId,
      );

      expect(updated.descriptionHtml).toContain('<strong>bold</strong>');
    });

    it('clears the rendered description when the source is cleared', async () => {
      const updated = await service.update(
        storyId,
        { description: '' },
        ownerId,
      );

      expect(updated.descriptionHtml).toBeNull();
    });

    it('records the old slug when the title changes', async () => {
      slugService.generateUniqueSlug.mockResolvedValue('a-new-slug');

      await service.update(storyId, { title: 'A New Title' }, ownerId);

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        expect.anything(),
        storyId,
        'the-long-way-home',
        'a-new-slug',
      );
    });

    // A creator may tidy the URL without touching the title, so the existing
    // title has to be what the new slug is derived from.
    it('regenerates the slug from the existing title when only the slug changes', async () => {
      await service.update(storyId, { slug: 'a-tidier-url' }, ownerId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({
          desiredSlug: 'a-tidier-url',
          title: 'The Long Way Home',
        }),
      );
    });

    it('leaves the slug alone when neither title nor slug changes', async () => {
      await service.update(storyId, { shortDescription: 'x' }, ownerId);

      expect(slugService.generateUniqueSlug).not.toHaveBeenCalled();
    });

    it('refuses a language that is not offered', async () => {
      await expect(
        service.update(storyId, { languageCode: 'xx' }, ownerId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('accepting the content policy', () => {
    it('records when the owner accepted it', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          contentPolicyAcceptedAt: null,
          contentPolicyVersion: null,
        }),
      );

      const accepted = await service.acceptContentPolicy(storyId, ownerId);

      expect(accepted.contentPolicyAcceptedAt).toBeInstanceOf(Date);
    });

    it('records which version was accepted', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          contentPolicyAcceptedAt: null,
          contentPolicyVersion: null,
        }),
      );

      const accepted = await service.acceptContentPolicy(storyId, ownerId);

      expect(accepted.contentPolicyVersion).toBe(STORYTIME_POLICY_VERSION);
    });

    // What matters is when they first agreed, and a creator who clicks twice
    // has not agreed twice.
    it('does not move the date when accepted again', async () => {
      const firstAccepted = new Date('2026-01-01T00:00:00Z');
      storyRepository.findOne.mockResolvedValue(
        buildStory({ contentPolicyAcceptedAt: firstAccepted }),
      );

      const accepted = await service.acceptContentPolicy(storyId, ownerId);

      expect(accepted.contentPolicyAcceptedAt).toBe(firstAccepted);
      expect(storyRepository.save).not.toHaveBeenCalled();
    });

    // Keeping the older date would claim they had read wording published
    // after they last looked.
    it('takes a fresh date when the terms have been superseded', async () => {
      const originallyAccepted = new Date('2026-01-01T00:00:00Z');
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          contentPolicyAcceptedAt: originallyAccepted,
          contentPolicyVersion: '0',
        }),
      );

      const accepted = await service.acceptContentPolicy(storyId, ownerId);

      expect(accepted.contentPolicyAcceptedAt).not.toBe(originallyAccepted);
      expect(accepted.contentPolicyVersion).toBe(STORYTIME_POLICY_VERSION);
      expect(storyRepository.save).toHaveBeenCalled();
    });

    // Accepting a policy on behalf of somebody else's Story would be a
    // declaration made in their name.
    it('refuses somebody who does not own the Story', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.acceptContentPolicy(storyId, 'stranger-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    // The publication checklist depends on it, so the two have to agree.
    it('lets a Story publish once it has been accepted', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          contentPolicyAcceptedAt: null,
          contentPolicyVersion: null,
        }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        /publishing terms/,
      );

      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(service.publish(storyId, ownerId)).resolves.toBeDefined();
    });
  });

  describe('publish', () => {
    it('publishes a Story that meets the checklist', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      const published = await service.publish(storyId, ownerId);

      expect(published.status).toBe(StoryStatus.PUBLISHED);
      expect(published.publishedAt).toBeInstanceOf(Date);
    });

    it('announces publication to the people who follow', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await service.publish(storyId, ownerId);

      expect(feedService.recordQuietly).toHaveBeenCalledWith(
        StorytimeActivityType.STORY_PUBLISHED,
        ownerId,
        { storyId },
      );
    });

    // Saving an already-published Story again is a creator tidying up, and
    // nobody's feed wants to hear about it.
    it('announces nothing when the Story was already published', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ status: StoryStatus.PUBLISHED }),
      );

      await service.publish(storyId, ownerId);

      expect(feedService.recordQuietly).not.toHaveBeenCalled();
    });

    it('keeps the original publication date when republishing', async () => {
      const firstPublished = new Date('2026-01-01T00:00:00Z');
      storyRepository.findOne.mockResolvedValue(
        buildStory({ publishedAt: firstPublished }),
      );

      const published = await service.publish(storyId, ownerId);

      expect(published.publishedAt).toBe(firstPublished);
    });

    it('refuses without a short description', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ shortDescription: null }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        /short description/,
      );
    });

    it('refuses without a published Chapter', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ publishedChapterCount: 0 }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        /published Chapter/,
      );
    });

    it('refuses without the publishing terms accepted', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          contentPolicyAcceptedAt: null,
          contentPolicyVersion: null,
        }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        /publishing terms/,
      );
    });

    // Being told to accept terms you already accepted looks like a bug unless
    // the message says the terms are not the ones you agreed to.
    it('says so when the accepted terms have been superseded', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          contentPolicyAcceptedAt: new Date('2026-01-01T00:00:00Z'),
          contentPolicyVersion: '0',
        }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        /publishing terms have changed/,
      );
    });

    it('reports every missing requirement at once', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          shortDescription: null,
          publishedChapterCount: 0,
          contentPolicyAcceptedAt: null,
          contentPolicyVersion: null,
        }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        /short description.*published Chapter.*publishing terms/s,
      );
    });

    // Otherwise a creator could republish their way out of a moderation
    // decision.
    it('refuses to publish a removed Story', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ moderationStatus: StorytimeModerationStatus.REMOVED }),
      );

      await expect(service.publish(storyId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('unpublish and archive', () => {
    beforeEach(() => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          publishedAt: new Date('2026-01-01T00:00:00Z'),
        }),
      );
    });

    it('withdraws a Story from publication', async () => {
      const result = await service.unpublish(storyId, ownerId);

      expect(result.status).toBe(StoryStatus.UNPUBLISHED);
    });

    // The original publication date survives a temporary withdrawal.
    it('keeps the publication date when unpublishing', async () => {
      const result = await service.unpublish(storyId, ownerId);

      expect(result.publishedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('archives a Story', async () => {
      const result = await service.archive(storyId, ownerId);

      expect(result.status).toBe(StoryStatus.ARCHIVED);
    });
  });

  describe('remove', () => {
    it('soft-deletes and records who did it', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await service.remove(storyId, ownerId);

      expect(storyRepository.softDelete).toHaveBeenCalledWith(storyId);
      expect(storyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ deletedByUserId: ownerId }),
      );
    });
  });

  describe('artwork', () => {
    const file = { originalname: 'banner.jpg' } as Express.Multer.File;

    it('records the stored image and what it shows', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      const saved = await service.setImage(
        storyId,
        ownerId,
        StorytimeImageSlot.STORY_BANNER,
        file,
        'The USS Ares at warp',
      );

      expect(imageService.store).toHaveBeenCalledWith({
        slot: StorytimeImageSlot.STORY_BANNER,
        userId: ownerId,
        entityId: storyId,
        file,
      });
      expect(saved.bannerImageId).toBe('stored-image-id');
      expect(saved.bannerImageAlt).toBe('The USS Ares at warp');
      expect(saved.version).toBe(2);
      expect(saved.updatedByUserId).toBe(ownerId);
    });

    it('sets the profile image without touching the banner', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ bannerImageId: 'banner-1', bannerImageAlt: 'A ship' }),
      );

      const saved = await service.setImage(
        storyId,
        ownerId,
        StorytimeImageSlot.STORY_PROFILE,
        file,
        'A crew badge',
      );

      expect(saved.profileImageId).toBe('stored-image-id');
      expect(saved.bannerImageId).toBe('banner-1');
    });

    // Released after the save rather than before it, so a failure leaves an
    // image nothing points at rather than a Story pointing at nothing.
    it('releases the image it replaced, once the Story is saved', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ bannerImageId: 'old-banner' }),
      );
      const order: string[] = [];
      storyRepository.save.mockImplementation((story: unknown) => {
        order.push('save');
        return Promise.resolve(story);
      });
      imageService.release.mockImplementation(() => {
        order.push('release');
        return Promise.resolve();
      });

      await service.setImage(
        storyId,
        ownerId,
        StorytimeImageSlot.STORY_BANNER,
        file,
        'A ship',
      );

      expect(imageService.release).toHaveBeenCalledWith('old-banner');
      expect(order).toEqual(['save', 'release']);
    });

    it('has nothing to release when there was no image', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await service.setImage(
        storyId,
        ownerId,
        StorytimeImageSlot.STORY_BANNER,
        file,
        'A ship',
      );

      expect(imageService.release).toHaveBeenCalledWith(null);
    });

    it('refuses somebody with no access to the Story', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.setImage(
          storyId,
          otherUserId,
          StorytimeImageSlot.STORY_BANNER,
          file,
          'A ship',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(imageService.store).not.toHaveBeenCalled();
    });

    // The wording goes with the picture: a description left behind would be
    // read out over whatever was uploaded next.
    it('clears the description along with the image', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({ bannerImageId: 'banner-1', bannerImageAlt: 'A ship' }),
      );

      const saved = await service.clearImage(
        storyId,
        ownerId,
        StorytimeImageSlot.STORY_BANNER,
      );

      expect(saved.bannerImageId).toBeNull();
      expect(saved.bannerImageAlt).toBeNull();
      expect(imageService.release).toHaveBeenCalledWith('banner-1');
      expect(saved.version).toBe(2);
    });

    it('refuses a removal from somebody with no access', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.clearImage(
          storyId,
          otherUserId,
          StorytimeImageSlot.STORY_PROFILE,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findPublicByIds', () => {
    it('returns the readable Stories', async () => {
      storyRepository.find.mockResolvedValue([
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
        }),
      ]);

      await expect(service.findPublicByIds(['story-1'])).resolves.toHaveLength(
        1,
      );
    });

    // A reader with an unlisted Story in their library reached it by link
    // already, so hiding it from their own history would lose it for them.
    it('includes an unlisted Story', async () => {
      storyRepository.find.mockResolvedValue([
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.UNLISTED,
        }),
      ]);

      await expect(service.findPublicByIds(['story-1'])).resolves.toHaveLength(
        1,
      );
    });

    it('drops a Story that is no longer readable', async () => {
      storyRepository.find.mockResolvedValue([
        buildStory({ visibility: StorytimeVisibility.PRIVATE }),
      ]);

      await expect(service.findPublicByIds(['story-1'])).resolves.toEqual([]);
    });

    // Asking the database for nothing would return every Story.
    it('asks for nothing when given no identifiers', async () => {
      await expect(service.findPublicByIds([])).resolves.toEqual([]);
      expect(storyRepository.find).not.toHaveBeenCalled();
    });
  });

  // The public rules, widened by the caller's own work. An Arc is usually
  // assembled before the Stories in it are published, and a reading order that
  // calls its own contents "a Story you can no longer see" is no use to the
  // person building it.
  describe('findVisibleByIds', () => {
    it('returns a Story anybody could read', async () => {
      storyRepository.find.mockResolvedValue([
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
        }),
      ]);

      await expect(
        service.findVisibleByIds(['story-1'], otherUserId),
      ).resolves.toHaveLength(1);
    });

    it('returns the caller’s own Story that nobody else could read', async () => {
      storyRepository.find.mockResolvedValue([
        buildStory({ visibility: StorytimeVisibility.PRIVATE }),
      ]);

      await expect(
        service.findVisibleByIds(['story-1'], ownerId),
      ).resolves.toHaveLength(1);
    });

    // Widened by ownership only. Somebody else's unpublished Story stays
    // unnamed until they publish it, which is the point of them agreeing
    // before it joins an Arc at all.
    it('drops somebody else’s unreadable Story', async () => {
      storyRepository.find.mockResolvedValue([
        buildStory({ visibility: StorytimeVisibility.PRIVATE }),
      ]);

      await expect(
        service.findVisibleByIds(['story-1'], otherUserId),
      ).resolves.toEqual([]);
    });

    // Asking the database for nothing would return every Story.
    it('asks for nothing when given no identifiers', async () => {
      await expect(service.findVisibleByIds([], ownerId)).resolves.toEqual([]);
      expect(storyRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('findPublicBySlug', () => {
    it('returns a published public Story', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-way-home'),
      ).resolves.toBeDefined();
    });

    // An unlisted Story is readable by anyone holding the link.
    it('returns an unlisted Story', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.UNLISTED,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-way-home'),
      ).resolves.toBeDefined();
    });

    it('hides a draft Story', async () => {
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.findPublicBySlug('the-long-way-home'),
      ).resolves.toBeNull();
    });

    it('hides a private Story', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PRIVATE,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-way-home'),
      ).resolves.toBeNull();
    });

    // A reader who followed a link deserves to know the Story was taken down
    // rather than being told it never existed.
    it('says a removed Story is gone rather than missing', async () => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
          moderationStatus: StorytimeModerationStatus.REMOVED,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-way-home'),
      ).rejects.toThrow(GoneException);
    });

    // Announcing a removal would let somebody probing slugs learn that a
    // private or unpublished Story exists, which is what "not found" protects.
    it.each([
      ['a draft', { status: StoryStatus.DRAFT }],
      ['a private', { visibility: StorytimeVisibility.PRIVATE }],
    ])('says nothing about %s Story that was removed', async (_name, state) => {
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
          moderationStatus: StorytimeModerationStatus.REMOVED,
          ...state,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-way-home'),
      ).resolves.toBeNull();
    });

    it('reports nothing for an unknown slug', async () => {
      await expect(service.findPublicBySlug('nope')).resolves.toBeNull();
    });
  });

  describe('findPublicByRetiredSlug', () => {
    it('finds the Story a retired slug belonged to', async () => {
      slugService.findByRetiredSlug.mockResolvedValue(storyId);
      storyRepository.findOne.mockResolvedValue(
        buildStory({
          status: StoryStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
        }),
      );

      await expect(
        service.findPublicByRetiredSlug('old-slug'),
      ).resolves.toBeDefined();
    });

    it('reports nothing when the slug was never used', async () => {
      await expect(
        service.findPublicByRetiredSlug('never-used'),
      ).resolves.toBeNull();
    });

    // A rename must not become a way to reach a Story that has since been
    // unpublished or removed.
    it('reports nothing when the Story is no longer readable', async () => {
      slugService.findByRetiredSlug.mockResolvedValue(storyId);
      storyRepository.findOne.mockResolvedValue(buildStory());

      await expect(
        service.findPublicByRetiredSlug('old-slug'),
      ).resolves.toBeNull();
    });

    it('reports nothing when the Story has since been deleted', async () => {
      slugService.findByRetiredSlug.mockResolvedValue(storyId);
      storyRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findPublicByRetiredSlug('old-slug'),
      ).resolves.toBeNull();
    });
  });

  describe('findPublicPaginated', () => {
    it('returns a page of Stories', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildStory()], 1]);

      const result = await service.findPublicPaginated({});

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(12);
    });

    // Two different questions: what is new to read, and what is being written
    // now. A landing page needs both, so they are two orderings.
    it('shows the newest publications by default', async () => {
      await service.findPublicPaginated({});

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'story.publishedAt',
        'DESC',
      );
    });

    it('shows the most recently changed when asked', async () => {
      await service.findPublicPaginated({
        sort: StorySort.RECENTLY_UPDATED,
      });

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'story.updatedAt',
        'DESC',
      );
    });

    it('honours the requested page and size', async () => {
      await service.findPublicPaginated({ page: 3, pageSize: 5 });

      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(queryBuilder.take).toHaveBeenCalledWith(5);
    });

    // Unlisted Stories are readable by link but must not be discoverable.
    it('lists only public Stories', async () => {
      await service.findPublicPaginated({});

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'story.visibility = :visibility',
        { visibility: StorytimeVisibility.PUBLIC },
      );
    });

    it('filters by rating when asked', async () => {
      await service.findPublicPaginated({ contentRating: 'MATURE' as never });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'story.contentRating = :contentRating',
        expect.anything(),
      );
    });

    it('filters by language when asked', async () => {
      await service.findPublicPaginated({ languageCode: 'de' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'story.languageCode = :languageCode',
        { languageCode: 'de' },
      );
    });

    it('filters by completion state when asked', async () => {
      await service.findPublicPaginated({
        completionState: 'COMPLETED' as never,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'story.completionState = :completionState',
        expect.anything(),
      );
    });

    it('filters by creator when asked', async () => {
      await service.findPublicPaginated({ ownerUserId: ownerId });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'story.ownerUserId = :ownerUserId',
        { ownerUserId: ownerId },
      );
    });
  });

  describe('reorder', () => {
    const secondId = 'e6d3a1b2-0000-4000-8000-0000000000bb';

    beforeEach(() => {
      storyRepository.find.mockResolvedValue([
        buildStory({ id: storyId, ownerOrderIndex: 1000 }),
        buildStory({ id: secondId, ownerOrderIndex: 2000 }),
      ]);
      storyRepository.save.mockImplementation(input => Promise.resolve(input));
    });

    it('renumbers the collection into the order given', async () => {
      const result = await service.reorder([secondId, storyId], ownerId);
      const byId = new Map(result.map(story => [story.id, story]));

      expect(byId.get(secondId)?.ownerOrderIndex).toBe(1000);
      expect(byId.get(storyId)?.ownerOrderIndex).toBe(2000);
    });

    it('refuses a list that omits a Story', async () => {
      await expect(service.reorder([storyId], ownerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a list naming a Story the caller does not own', async () => {
      await expect(
        service.reorder(
          [storyId, 'e6d3a1b2-0000-4000-8000-0000000000cc'],
          ownerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a list containing duplicates', async () => {
      await expect(
        service.reorder([storyId, storyId], ownerId),
      ).rejects.toThrow(/duplicates/);
    });
  });

  describe('collaborator access', () => {
    beforeEach(() => {
      storyRepository.findOne.mockResolvedValue(buildStory());
    });

    describe('findEditableOrFail', () => {
      it('lets the owner do anything without asking about collaborations', async () => {
        await expect(
          service.findEditableOrFail(
            storyId,
            ownerId,
            StoryCapability.MANAGE_CHAPTERS,
          ),
        ).resolves.toBeDefined();

        expect(collaboratorAccessService.hasCapability).not.toHaveBeenCalled();
      });

      it('lets a collaborator granted the capability through', async () => {
        collaboratorAccessService.hasCapability.mockResolvedValue(true);

        await expect(
          service.findEditableOrFail(
            storyId,
            otherUserId,
            StoryCapability.MANAGE_CHAPTERS,
          ),
        ).resolves.toBeDefined();
      });

      it('asks about the capability actually being used', async () => {
        collaboratorAccessService.hasCapability.mockResolvedValue(true);

        await service.findEditableOrFail(
          storyId,
          otherUserId,
          StoryCapability.MANAGE_CREW,
        );

        expect(collaboratorAccessService.hasCapability).toHaveBeenCalledWith(
          storyId,
          otherUserId,
          StoryCapability.MANAGE_CREW,
        );
      });

      it('refuses a collaborator who was not granted it', async () => {
        await expect(
          service.findEditableOrFail(
            storyId,
            otherUserId,
            StoryCapability.EDIT_STORY,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('refuses a stranger', async () => {
        await expect(
          service.findEditableOrFail(
            storyId,
            otherUserId,
            StoryCapability.EDIT_STORY,
          ),
        ).rejects.toThrow(ForbiddenException);
      });

      it('reports a Story that does not exist', async () => {
        storyRepository.findOne.mockResolvedValue(null);

        await expect(
          service.findEditableOrFail(
            storyId,
            ownerId,
            StoryCapability.EDIT_STORY,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('findAccessibleOrFail', () => {
      it('lets the owner in', async () => {
        await expect(
          service.findAccessibleOrFail(storyId, ownerId),
        ).resolves.toBeDefined();
      });

      // A collaborator invited only to write Chapters still has to open the
      // Story to reach them.
      it('lets any accepted collaborator in, whatever they were granted', async () => {
        collaboratorAccessService.findAccepted.mockResolvedValue({
          canEditStory: false,
          canManageChapters: false,
        });

        await expect(
          service.findAccessibleOrFail(storyId, otherUserId),
        ).resolves.toBeDefined();
      });

      it('refuses somebody with no accepted collaboration', async () => {
        await expect(
          service.findAccessibleOrFail(storyId, otherUserId),
        ).rejects.toThrow(ForbiddenException);
      });

      it('reports a Story that does not exist', async () => {
        storyRepository.findOne.mockResolvedValue(null);

        await expect(
          service.findAccessibleOrFail(storyId, ownerId),
        ).rejects.toThrow(NotFoundException);
      });
    });

    // Publishing is never delegated, so these stay owner-only however
    // generously somebody has been invited.
    describe('what a collaborator can never do', () => {
      beforeEach(() => {
        collaboratorAccessService.hasCapability.mockResolvedValue(true);
        collaboratorAccessService.findAccepted.mockResolvedValue({
          canEditStory: true,
        });
      });

      it.each([
        ['publish', () => service.publish(storyId, otherUserId)],
        ['unpublish', () => service.unpublish(storyId, otherUserId)],
        ['archive', () => service.archive(storyId, otherUserId)],
        ['delete', () => service.remove(storyId, otherUserId)],
      ])('refuses to let a collaborator %s a Story', async (_name, act) => {
        await expect(act()).rejects.toThrow(ForbiddenException);
      });
    });

    it('lets a collaborator granted it edit the Story', async () => {
      collaboratorAccessService.hasCapability.mockResolvedValue(true);

      await expect(
        service.update(storyId, { title: 'Renamed' }, otherUserId),
      ).resolves.toBeDefined();
    });

    it('refuses an edit from a collaborator not granted it', async () => {
      await expect(
        service.update(storyId, { title: 'Renamed' }, otherUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
