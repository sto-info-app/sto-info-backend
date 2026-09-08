import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AccessControlService } from '../../access-control/access-control.service';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeStoryEntity } from './entities/storytime-story.entity';
import { StorytimeCreatorStoriesController } from './storytime-creator-stories.controller';
import { StorytimeStoryMapper } from './storytime-story.mapper';
import { StorytimeStoryService } from './storytime-story.service';

describe('StorytimeCreatorStoriesController', () => {
  let controller: StorytimeCreatorStoriesController;
  let storyService: Record<string, jest.Mock>;
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const storyId = 'e6d3a1b2-0000-4000-8000-0000000000aa';
  const story = Object.assign(new StorytimeStoryEntity(), {
    id: storyId,
    slug: 'a-story',
    title: 'A Story',
    upVoteCount: 0,
    downVoteCount: 0,
  });

  beforeEach(async () => {
    storyService = {
      findOwnedByUser: jest.fn().mockResolvedValue([story]),
      findOwnedOrFail: jest.fn().mockResolvedValue(story),
      findAccessibleOrFail: jest.fn().mockResolvedValue(story),
      create: jest.fn().mockResolvedValue(story),
      update: jest.fn().mockResolvedValue(story),
      acceptContentPolicy: jest.fn().mockResolvedValue(story),
      publish: jest.fn().mockResolvedValue(story),
      unpublish: jest.fn().mockResolvedValue(story),
      archive: jest.fn().mockResolvedValue(story),
      reorder: jest.fn().mockResolvedValue([story]),
      remove: jest.fn().mockResolvedValue(undefined),
      setImage: jest.fn().mockResolvedValue(story),
      clearImage: jest.fn().mockResolvedValue(story),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeCreatorStoriesController],
      providers: [
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeStoryMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
        // The permissions guard declared on the controller needs this to be
        // constructible. Its behaviour is covered by its own spec; here the
        // controller's own logic is what is under test.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<StorytimeCreatorStoriesController>(
      StorytimeCreatorStoriesController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the caller Stories', async () => {
    await expect(controller.findMine(userId)).resolves.toHaveLength(1);
    expect(storyService.findOwnedByUser).toHaveBeenCalledWith(userId);
  });

  it('retrieves one of the caller Stories', async () => {
    await expect(controller.findOne(storyId, userId)).resolves.toBeDefined();
    expect(storyService.findAccessibleOrFail).toHaveBeenCalledWith(
      storyId,
      userId,
    );
  });

  it('creates a Story owned by the caller', async () => {
    await controller.create({ title: 'A Story' }, userId);

    expect(storyService.create).toHaveBeenCalledWith(
      { title: 'A Story' },
      userId,
    );
  });

  it('updates a Story', async () => {
    await controller.update(storyId, { title: 'New' }, userId);

    expect(storyService.update).toHaveBeenCalledWith(
      storyId,
      { title: 'New' },
      userId,
    );
  });

  it('records that the caller accepted the content policy', async () => {
    await controller.acceptContentPolicy(storyId, userId);

    expect(storyService.acceptContentPolicy).toHaveBeenCalledWith(
      storyId,
      userId,
    );
  });

  it('publishes a Story', async () => {
    await controller.publish(storyId, userId);

    expect(storyService.publish).toHaveBeenCalledWith(storyId, userId);
  });

  it('unpublishes a Story', async () => {
    await controller.unpublish(storyId, userId);

    expect(storyService.unpublish).toHaveBeenCalledWith(storyId, userId);
  });

  it('archives a Story', async () => {
    await controller.archive(storyId, userId);

    expect(storyService.archive).toHaveBeenCalledWith(storyId, userId);
  });

  it('reorders the caller Stories', async () => {
    await controller.reorder({ storyIds: [storyId] }, userId);

    expect(storyService.reorder).toHaveBeenCalledWith([storyId], userId);
  });

  it('deletes a Story', async () => {
    await controller.remove(storyId, userId);

    expect(storyService.remove).toHaveBeenCalledWith(storyId, userId);
  });

  describe('artwork', () => {
    const file = { originalname: 'banner.jpg' } as Express.Multer.File;

    it.each([
      ['setBannerImage', StorytimeImageSlot.STORY_BANNER],
      ['setProfileImage', StorytimeImageSlot.STORY_PROFILE],
    ] as const)(
      '%s passes the upload and its description on',
      async (method, slot) => {
        await controller[method](storyId, userId, file, {
          altText: 'The USS Ares at warp',
        });

        expect(storyService.setImage).toHaveBeenCalledWith(
          storyId,
          userId,
          slot,
          file,
          'The USS Ares at warp',
        );
      },
    );

    it.each([
      ['clearBannerImage', StorytimeImageSlot.STORY_BANNER],
      ['clearProfileImage', StorytimeImageSlot.STORY_PROFILE],
    ] as const)('%s asks for that slot to be emptied', async (method, slot) => {
      await controller[method](storyId, userId);

      expect(storyService.clearImage).toHaveBeenCalledWith(
        storyId,
        userId,
        slot,
      );
    });

    // Multer leaves the file undefined when the part is missing or the filter
    // rejected it, and an upload with no image is worth saying so about.
    it('complains when no file arrived', async () => {
      await expect(
        controller.setBannerImage(storyId, userId, undefined, {
          altText: 'A ship',
        }),
      ).rejects.toThrow('An image file is required');

      expect(storyService.setImage).not.toHaveBeenCalled();
    });
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
      ['findMine', () => controller.findMine(userId)],
      ['findOne', () => controller.findOne(storyId, userId)],
      ['create', () => controller.create({ title: 'x' }, userId)],
      ['update', () => controller.update(storyId, {}, userId)],
      [
        'acceptContentPolicy',
        () => controller.acceptContentPolicy(storyId, userId),
      ],
      ['publish', () => controller.publish(storyId, userId)],
      ['unpublish', () => controller.unpublish(storyId, userId)],
      ['archive', () => controller.archive(storyId, userId)],
      ['reorder', () => controller.reorder({ storyIds: [storyId] }, userId)],
      ['remove', () => controller.remove(storyId, userId)],
      [
        'setBannerImage',
        () =>
          controller.setBannerImage(
            storyId,
            userId,
            { originalname: 'banner.jpg' } as Express.Multer.File,
            { altText: 'A ship' },
          ),
      ],
      [
        'clearProfileImage',
        () => controller.clearProfileImage(storyId, userId),
      ],
    ])('refuses %s', async (_name, call) => {
      await expect(call()).rejects.toThrow(NotFoundException);
    });
  });
});
