import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeChapterEntity } from './entities/storytime-chapter.entity';
import { StorytimeChapterMapper } from './storytime-chapter.mapper';
import { StorytimeChapterService } from './storytime-chapter.service';
import { StorytimeCreatorChaptersController } from './storytime-creator-chapters.controller';

describe('StorytimeCreatorChaptersController', () => {
  let controller: StorytimeCreatorChaptersController;
  let chapterService: Record<string, jest.Mock>;
  let storyService: { findOwnedOrFail: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const chapterId = 'e6d3a1b2-0000-4000-8000-0000000000bb';

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: storyId,
    languageCode: 'en',
  });

  const chapter = Object.assign(new StorytimeChapterEntity(), {
    id: chapterId,
    storyId,
    title: 'Chapter One',
    slug: 'chapter-one',
    contentSource: 'Words',
    upVoteCount: 0,
    downVoteCount: 0,
    languageCode: null,
  });

  beforeEach(async () => {
    chapterService = {
      findForOwner: jest.fn().mockResolvedValue([chapter]),
      findEditableOrFail: jest.fn().mockResolvedValue(chapter),
      create: jest.fn().mockResolvedValue(chapter),
      update: jest.fn().mockResolvedValue(chapter),
      publish: jest.fn().mockResolvedValue(chapter),
      unpublish: jest.fn().mockResolvedValue(chapter),
      schedule: jest.fn().mockResolvedValue(chapter),
      reorder: jest.fn().mockResolvedValue([chapter]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    storyService = { findOwnedOrFail: jest.fn().mockResolvedValue(story) };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeCreatorChaptersController],
      providers: [
        { provide: StorytimeChapterService, useValue: chapterService },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeChapterMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
        // The permissions guard on the controller needs this to be
        // constructible; its behaviour is covered by its own spec.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<StorytimeCreatorChaptersController>(
      StorytimeCreatorChaptersController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the Chapters of a Story', async () => {
    await expect(controller.findAll(storyId, userId)).resolves.toHaveLength(1);
    expect(chapterService.findForOwner).toHaveBeenCalledWith(storyId, userId);
  });

  it('creates a Chapter', async () => {
    await controller.create(storyId, { title: 'Chapter One' }, userId);

    expect(chapterService.create).toHaveBeenCalledWith(
      storyId,
      { title: 'Chapter One' },
      userId,
    );
  });

  it('retrieves a Chapter for editing', async () => {
    const result = await controller.findOne(chapterId, userId);

    expect(result.title).toBe('Chapter One');
    expect(result.contentSource).toBe('Words');
  });

  it('updates a Chapter', async () => {
    await controller.update(chapterId, { title: 'New' }, userId);

    expect(chapterService.update).toHaveBeenCalledWith(
      chapterId,
      { title: 'New' },
      userId,
    );
  });

  it('publishes a Chapter', async () => {
    await controller.publish(chapterId, userId);

    expect(chapterService.publish).toHaveBeenCalledWith(chapterId, userId);
  });

  it('unpublishes a Chapter', async () => {
    await controller.unpublish(chapterId, userId);

    expect(chapterService.unpublish).toHaveBeenCalledWith(chapterId, userId);
  });

  it('schedules a Chapter', async () => {
    const publishAt = new Date('2030-01-01T00:00:00Z');

    await controller.schedule(chapterId, { publishAt }, userId);

    expect(chapterService.schedule).toHaveBeenCalledWith(
      chapterId,
      publishAt,
      userId,
    );
  });

  it('reorders the Chapters of a Story', async () => {
    await controller.reorder(storyId, { chapterIds: [chapterId] }, userId);

    expect(chapterService.reorder).toHaveBeenCalledWith(
      storyId,
      [chapterId],
      userId,
    );
  });

  it('deletes a Chapter', async () => {
    await controller.remove(chapterId, userId);

    expect(chapterService.remove).toHaveBeenCalledWith(chapterId, userId);
  });

  // Every route checks the switch, so disabling creation takes the whole
  // creator surface offline rather than only the parts somebody remembered.
  describe('when creation is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new NotFoundException(),
      );
    });

    it.each([
      ['findAll', () => controller.findAll(storyId, userId)],
      ['create', () => controller.create(storyId, { title: 'x' }, userId)],
      ['findOne', () => controller.findOne(chapterId, userId)],
      ['update', () => controller.update(chapterId, {}, userId)],
      ['publish', () => controller.publish(chapterId, userId)],
      ['unpublish', () => controller.unpublish(chapterId, userId)],
      [
        'schedule',
        () => controller.schedule(chapterId, { publishAt: new Date() }, userId),
      ],
      [
        'reorder',
        () => controller.reorder(storyId, { chapterIds: [chapterId] }, userId),
      ],
      ['remove', () => controller.remove(chapterId, userId)],
    ])('refuses %s', async (_name, call) => {
      await expect(call()).rejects.toThrow(NotFoundException);
    });
  });
});
