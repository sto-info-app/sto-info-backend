import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationService } from '../../notification/notification.service';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { SpotlightEntityType } from '../enums/spotlight-entity-type.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeSlugService } from '../shared/storytime-slug.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

describe('StorytimeSpotlightService', () => {
  let service: StorytimeSpotlightService;
  let spotlightRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let storyService: { findPublicByIds: jest.Mock };
  let arcService: { findPublicByIds: jest.Mock };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
  };
  let notificationService: { createNotification: jest.Mock };

  const editorId = 'editor-1';
  const spotlightId = 'spotlight-1';
  const storyId = 'story-1';
  const arcId = 'arc-1';
  const now = new Date('2026-06-15T12:00:00.000Z');

  /**
   * Builds a Spotlight entry.
   *
   * @param overrides - Fields to change.
   * @returns The entry.
   */
  const buildEntry = (
    overrides: Partial<StorytimeSpotlightEntity> = {},
  ): StorytimeSpotlightEntity =>
    Object.assign(new StorytimeSpotlightEntity(), {
      id: spotlightId,
      slug: 'a-fine-story',
      entityType: SpotlightEntityType.STORY,
      storyId,
      arcId: null,
      headline: 'A Fine Story',
      summary: 'Worth your evening.',
      selectionReason: null,
      overrideImageId: null,
      overrideImageAlt: null,
      displayPriority: 0,
      startsAt: new Date('2026-06-01T00:00:00.000Z'),
      endsAt: null,
      isPublished: false,
      createdByUserId: editorId,
      updatedByUserId: editorId,
      ...overrides,
    });

  /**
   * Builds a Story that may be featured.
   *
   * @param overrides - Fields to change.
   * @returns The Story.
   */
  const buildStory = (
    overrides: Partial<StorytimeStoryEntity> = {},
  ): StorytimeStoryEntity =>
    Object.assign(new StorytimeStoryEntity(), {
      id: storyId,
      title: 'A Fine Story',
      ownerUserId: 'writer-1',
      visibility: StorytimeVisibility.PUBLIC,
      ...overrides,
    });

  /**
   * Builds an Arc that may be featured.
   *
   * @param overrides - Fields to change.
   * @returns The Arc.
   */
  const buildArc = (
    overrides: Partial<StorytimeArcEntity> = {},
  ): StorytimeArcEntity =>
    Object.assign(new StorytimeArcEntity(), {
      id: arcId,
      title: 'The Long War',
      ownerUserId: 'curator-1',
      visibility: StorytimeVisibility.PUBLIC,
      ...overrides,
    });

  beforeEach(async () => {
    spotlightRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeSpotlightEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    storyService = {
      findPublicByIds: jest.fn().mockResolvedValue([buildStory()]),
    };
    arcService = {
      findPublicByIds: jest.fn().mockResolvedValue([buildArc()]),
    };
    slugService = {
      generateUniqueSlug: jest.fn(async request => {
        await request.isTakenByLiveEntity('candidate');
        return 'a-fine-story';
      }),
      recordRetiredSlug: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeSpotlightService,
        {
          provide: getRepositoryToken(StorytimeSpotlightEntity),
          useValue: spotlightRepository,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeArcService, useValue: arcService },
        { provide: StorytimeSlugService, useValue: slugService },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get<StorytimeSpotlightService>(StorytimeSpotlightService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('what is showing', () => {
    it('asks for entries that have started and not ended', async () => {
      await service.findShowing(now);

      expect(spotlightRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { displayPriority: 'DESC', startsAt: 'DESC' },
        }),
      );
    });

    it('attaches the featured Story', async () => {
      spotlightRepository.find.mockResolvedValue([buildEntry()]);

      const [showing] = await service.findShowing(now);

      expect(showing.story?.id).toBe(storyId);
      expect(showing.arc).toBeNull();
    });

    it('attaches the featured Arc', async () => {
      spotlightRepository.find.mockResolvedValue([
        buildEntry({
          entityType: SpotlightEntityType.ARC,
          storyId: null,
          arcId,
        }),
      ]);

      const [showing] = await service.findShowing(now);

      expect(showing.arc?.id).toBe(arcId);
      expect(showing.story).toBeNull();
    });

    // The whole point of pointing rather than copying: a Story taken down
    // leaves the Spotlight by itself.
    it('leaves out an entry whose Story is no longer readable', async () => {
      spotlightRepository.find.mockResolvedValue([buildEntry()]);
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(service.findShowing(now)).resolves.toEqual([]);
    });

    // Unlisted means readable by link but never surfaced by browsing, and the
    // Spotlight is the most prominent browsing surface there is.
    it('leaves out an entry whose Story has been made unlisted', async () => {
      spotlightRepository.find.mockResolvedValue([buildEntry()]);
      storyService.findPublicByIds.mockResolvedValue([
        buildStory({ visibility: StorytimeVisibility.UNLISTED }),
      ]);

      await expect(service.findShowing(now)).resolves.toEqual([]);
    });

    it('leaves out an entry whose Arc is no longer readable', async () => {
      spotlightRepository.find.mockResolvedValue([
        buildEntry({
          entityType: SpotlightEntityType.ARC,
          storyId: null,
          arcId,
        }),
      ]);
      arcService.findPublicByIds.mockResolvedValue([]);

      await expect(service.findShowing(now)).resolves.toEqual([]);
    });

    // Every caller in the application asks about now, so the parameter exists
    // for the tests and the default is the real path.
    it('judges the schedule against now by default', async () => {
      await expect(service.findShowing()).resolves.toEqual([]);
      await expect(service.findArchive()).resolves.toEqual([]);
      await expect(service.findBySlug('a-fine-story')).resolves.toBeNull();
    });

    it('asks for nothing when there are no entries', async () => {
      await expect(service.findShowing(now)).resolves.toEqual([]);
      expect(storyService.findPublicByIds).not.toHaveBeenCalled();
    });

    // One lookup per kind, not one per entry.
    it('resolves every Story in a single lookup', async () => {
      spotlightRepository.find.mockResolvedValue([
        buildEntry(),
        buildEntry({ id: 'spotlight-2', storyId: 'story-2' }),
      ]);

      await service.findShowing(now);

      expect(storyService.findPublicByIds).toHaveBeenCalledTimes(1);
      expect(storyService.findPublicByIds).toHaveBeenCalledWith([
        storyId,
        'story-2',
      ]);
    });
  });

  describe('the archive', () => {
    it('lists entries that have finished, most recent first', async () => {
      await service.findArchive(now);

      expect(spotlightRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { endsAt: 'DESC' } }),
      );
    });

    it('attaches the featured work', async () => {
      spotlightRepository.find.mockResolvedValue([
        buildEntry({ endsAt: new Date('2026-06-10T00:00:00.000Z') }),
      ]);

      const [past] = await service.findArchive(now);

      expect(past.story?.id).toBe(storyId);
    });
  });

  describe('reading one entry', () => {
    it('reads a showing entry by its address', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ isPublished: true }),
      );

      const resolved = await service.findBySlug('a-fine-story', now);

      expect(resolved?.entry.id).toBe(spotlightId);
    });

    // Announcing an editorial decision before it is made public would defeat
    // scheduling it.
    it('hides an entry that has not started yet', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({
          isPublished: true,
          startsAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );

      await expect(service.findBySlug('a-fine-story', now)).resolves.toBeNull();
    });

    it('hides an unpublished entry', async () => {
      spotlightRepository.findOne.mockResolvedValue(buildEntry());

      await expect(service.findBySlug('a-fine-story', now)).resolves.toBeNull();
    });

    it('reports a slug nothing answers to', async () => {
      await expect(service.findBySlug('nothing', now)).resolves.toBeNull();
    });

    it('hides an entry whose work is no longer readable', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ isPublished: true }),
      );
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(service.findBySlug('a-fine-story', now)).resolves.toBeNull();
    });
  });

  describe('editorial listing', () => {
    it('lists every entry, showing or not', async () => {
      await service.findAll();

      expect(spotlightRepository.find).toHaveBeenCalledWith({
        order: { startsAt: 'DESC' },
      });
    });

    // An editor reads a list of names, not a list of identifiers.
    it('attaches the work each entry features', async () => {
      spotlightRepository.find.mockResolvedValue([buildEntry()]);

      const [resolved] = await service.findAll();

      expect(resolved.story?.title).toBe('A Fine Story');
    });

    // The entry an editor most needs to find is the one pointing at work that
    // has gone, so it is listed carrying no work rather than dropped.
    it('lists an entry whose work can no longer be shown', async () => {
      spotlightRepository.find.mockResolvedValue([buildEntry()]);
      storyService.findPublicByIds.mockResolvedValue([]);

      const entries = await service.findAll();

      expect(entries).toHaveLength(1);
      expect(entries[0].story).toBeNull();
    });

    it('retrieves one entry', async () => {
      spotlightRepository.findOne.mockResolvedValue(buildEntry());

      await expect(service.findOneOrFail(spotlightId)).resolves.toBeDefined();
    });

    it('retrieves one entry with the work it features', async () => {
      spotlightRepository.findOne.mockResolvedValue(buildEntry());

      const resolved = await service.findOneWithWorkOrFail(spotlightId);

      expect(resolved.entry.id).toBe(spotlightId);
      expect(resolved.story?.title).toBe('A Fine Story');
    });

    it('reports an entry that is not there when reading it with its work', async () => {
      await expect(service.findOneWithWorkOrFail(spotlightId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reports an entry that is not there', async () => {
      await expect(service.findOneOrFail(spotlightId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('drafting', () => {
    /** The smallest valid creation request. */
    const request = {
      entityType: SpotlightEntityType.STORY,
      storyId,
      headline: 'A Fine Story',
      summary: 'Worth your evening.',
      startsAt: '2026-06-01T00:00:00.000Z',
    };

    it('creates an entry', async () => {
      const created = await service.create(request, editorId);

      expect(created.headline).toBe('A Fine Story');
      expect(created.storyId).toBe(storyId);
      expect(created.createdByUserId).toBe(editorId);
    });

    // Saving the copy and deciding it is ready are different decisions, often
    // made on different days.
    it('creates it unpublished', async () => {
      const created = await service.create(request, editorId);

      expect(created.isPublished).toBe(false);
    });

    it('names the Spotlight slug scope so it is unique site-wide', async () => {
      await service.create(request, editorId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: StorytimeTargetType.SPOTLIGHT,
        }),
      );
    });

    it('carries only the target matching the kind featured', async () => {
      const created = await service.create(
        {
          ...request,
          entityType: SpotlightEntityType.ARC,
          arcId,
        },
        editorId,
      );

      expect(created.arcId).toBe(arcId);
      expect(created.storyId).toBeNull();
    });

    it('refuses a Story that is not published and public', async () => {
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(service.create(request, editorId)).rejects.toThrow(
        /must be published and public/,
      );
    });

    it('refuses an Arc that is not published and public', async () => {
      arcService.findPublicByIds.mockResolvedValue([
        buildArc({ visibility: StorytimeVisibility.PRIVATE }),
      ]);

      await expect(
        service.create(
          { ...request, entityType: SpotlightEntityType.ARC, arcId },
          editorId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // The request DTO requires the matching identifier, but the service is
    // reachable from anywhere and must not take a missing one on trust.
    it.each([
      ['a Story', { ...request, storyId: undefined }],
      [
        'an Arc',
        {
          ...request,
          entityType: SpotlightEntityType.ARC,
          storyId: undefined,
          arcId: undefined,
        },
      ],
    ])('refuses an entry naming no %s at all', async (_name, incomplete) => {
      storyService.findPublicByIds.mockResolvedValue([]);
      arcService.findPublicByIds.mockResolvedValue([]);

      await expect(service.create(incomplete, editorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a period that ends before it starts', async () => {
      await expect(
        service.create(
          { ...request, endsAt: '2026-05-01T00:00:00.000Z' },
          editorId,
        ),
      ).rejects.toThrow(/must end after it starts/);
    });

    it('accepts an open-ended entry', async () => {
      const created = await service.create(request, editorId);

      expect(created.endsAt).toBeNull();
    });
  });

  describe('changing an entry', () => {
    beforeEach(() => {
      spotlightRepository.findOne.mockResolvedValue(buildEntry());
    });

    it('changes the editorial copy', async () => {
      const updated = await service.update(
        spotlightId,
        { headline: 'Read This' },
        editorId,
      );

      expect(updated.headline).toBe('Read This');
      expect(updated.updatedByUserId).toBe(editorId);
    });

    it('leaves anything not sent alone', async () => {
      const updated = await service.update(spotlightId, {}, editorId);

      expect(updated.summary).toBe('Worth your evening.');
      expect(updated.startsAt).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    });

    it('clears the selection reason when it is emptied', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ selectionReason: 'Because.' }),
      );

      const updated = await service.update(
        spotlightId,
        { selectionReason: null },
        editorId,
      );

      expect(updated.selectionReason).toBeNull();
    });

    it('clears the override image when it is emptied', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ overrideImageId: 'image-1', overrideImageAlt: 'A ship' }),
      );

      const updated = await service.update(
        spotlightId,
        { overrideImageId: null, overrideImageAlt: null },
        editorId,
      );

      expect(updated.overrideImageId).toBeNull();
      expect(updated.overrideImageAlt).toBeNull();
    });

    it('makes an entry open-ended again', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ endsAt: new Date('2026-06-30T00:00:00.000Z') }),
      );

      const updated = await service.update(
        spotlightId,
        { endsAt: null },
        editorId,
      );

      expect(updated.endsAt).toBeNull();
    });

    it('reschedules an entry', async () => {
      const updated = await service.update(
        spotlightId,
        {
          startsAt: '2026-07-01T00:00:00.000Z',
          endsAt: '2026-07-08T00:00:00.000Z',
        },
        editorId,
      );

      expect(updated.startsAt).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(updated.endsAt).toEqual(new Date('2026-07-08T00:00:00.000Z'));
    });

    it('refuses a reschedule that ends before it starts', async () => {
      await expect(
        service.update(
          spotlightId,
          { endsAt: '2026-05-01T00:00:00.000Z' },
          editorId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('points an entry at a different Story', async () => {
      storyService.findPublicByIds.mockResolvedValue([
        buildStory({ id: 'story-2' }),
      ]);

      const updated = await service.update(
        spotlightId,
        { storyId: 'story-2' },
        editorId,
      );

      expect(updated.storyId).toBe('story-2');
    });

    // The entity type cannot change, so an Arc sent to a Story entry is
    // ignored rather than quietly repointing what readers are looking at.
    it('ignores an Arc sent to an entry featuring a Story', async () => {
      const updated = await service.update(spotlightId, { arcId }, editorId);

      expect(updated.arcId).toBeNull();
      expect(updated.storyId).toBe(storyId);
    });

    it('ignores a Story sent to an entry featuring an Arc', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({
          entityType: SpotlightEntityType.ARC,
          storyId: null,
          arcId,
        }),
      );

      const updated = await service.update(spotlightId, { storyId }, editorId);

      expect(updated.storyId).toBeNull();
      expect(updated.arcId).toBe(arcId);
    });

    it('retires the old slug when it changes', async () => {
      slugService.generateUniqueSlug.mockResolvedValue('read-this');

      await service.update(spotlightId, { slug: 'read-this' }, editorId);

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        StorytimeTargetType.SPOTLIGHT,
        spotlightId,
        'a-fine-story',
        'read-this',
      );
    });

    it('leaves the slug alone when the same one is sent', async () => {
      await service.update(spotlightId, { slug: 'a-fine-story' }, editorId);

      expect(slugService.generateUniqueSlug).not.toHaveBeenCalled();
    });

    it('lets an entry keep its own slug', async () => {
      spotlightRepository.findOne
        .mockResolvedValueOnce(buildEntry())
        .mockResolvedValue(buildEntry());
      slugService.generateUniqueSlug.mockImplementation(async request => {
        await request.isTakenByLiveEntity('a-fine-story');
        return 'a-fine-story';
      });

      await expect(
        service.update(spotlightId, { slug: 'read-this' }, editorId),
      ).resolves.toBeDefined();
    });

    it('refuses to point an entry at unfeaturable work', async () => {
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(
        service.update(spotlightId, { storyId: 'story-2' }, editorId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishing', () => {
    beforeEach(() => {
      spotlightRepository.findOne.mockResolvedValue(buildEntry());
    });

    it('publishes an entry', async () => {
      const published = await service.publish(spotlightId, editorId);

      expect(published.isPublished).toBe(true);
      expect(published.updatedByUserId).toBe(editorId);
    });

    it('tells the writer their work was chosen', async () => {
      await service.publish(spotlightId, editorId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'writer-1',
          body: expect.stringContaining('A Fine Story'),
        }),
      );
    });

    it('tells the curator when an Arc is chosen', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({
          entityType: SpotlightEntityType.ARC,
          storyId: null,
          arcId,
        }),
      );

      await service.publish(spotlightId, editorId);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'curator-1' }),
      );
    });

    // Correcting a typo in a published entry should not congratulate somebody
    // a second time.
    it('says nothing when the entry was already published', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ isPublished: true }),
      );

      await service.publish(spotlightId, editorId);

      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    it.each([
      ['an Error', new Error('mail is down')],
      ['a non-Error', 'mail is down'],
    ])(
      'still publishes when the notification fails with %s',
      async (_name, failure) => {
        notificationService.createNotification.mockRejectedValue(failure);

        await expect(
          service.publish(spotlightId, editorId),
        ).resolves.toBeDefined();
      },
    );

    // A work taken down between drafting and publishing must not be published
    // into a Spotlight it can never appear in.
    it('refuses to publish an entry whose work cannot be featured', async () => {
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(service.publish(spotlightId, editorId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('withdraws an entry', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ isPublished: true }),
      );

      const withdrawn = await service.unpublish(spotlightId, editorId);

      expect(withdrawn.isPublished).toBe(false);
    });

    // Withdrawing has to work even when the work has been removed, since that
    // is one of the reasons an editor would withdraw it.
    it('withdraws an entry whose work has gone', async () => {
      spotlightRepository.findOne.mockResolvedValue(
        buildEntry({ isPublished: true }),
      );
      storyService.findPublicByIds.mockResolvedValue([]);

      await expect(
        service.unpublish(spotlightId, editorId),
      ).resolves.toBeDefined();
    });
  });

  describe('deleting', () => {
    it('deletes an entry', async () => {
      spotlightRepository.findOne.mockResolvedValue(buildEntry());

      await service.remove(spotlightId, editorId);

      expect(spotlightRepository.softDelete).toHaveBeenCalledWith(spotlightId);
    });

    it('reports an entry that is not there', async () => {
      await expect(service.remove(spotlightId, editorId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
