import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { STORYTIME_FEATURE_FLAGS } from '../constants/storytime-feature.constants';
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeArcMembershipPresenter } from './storytime-arc-membership.presenter';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';
import { StorytimeCreatorArcsController } from './storytime-creator-arcs.controller';

describe('StorytimeCreatorArcsController', () => {
  let controller: StorytimeCreatorArcsController;
  let arcService: {
    findOwnedByUser: jest.Mock;
    findOwnedOrFail: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    publish: jest.Mock;
    unpublish: jest.Mock;
    remove: jest.Mock;
    setImage: jest.Mock;
    clearImage: jest.Mock;
  };
  let membershipService: {
    findByArcForCurator: jest.Mock;
    findApprovedByArc: jest.Mock;
    invite: jest.Mock;
    reorder: jest.Mock;
  };
  let storyService: { findVisibleByIds: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const userId = 'curator-1';
  const arcId = 'arc-1';
  const storyId = 'story-1';

  const arc = Object.assign(new StorytimeArcEntity(), {
    id: arcId,
    slug: 'the-long-war',
    title: 'The Long War',
    ownerUserId: userId,
    shortDescription: null,
    description: null,
    descriptionHtml: null,
    status: ArcStatus.DRAFT,
    visibility: StorytimeVisibility.PRIVATE,
    languageCode: 'en',
    bannerImageId: null,
    profileImageId: null,
    upVoteCount: 0,
    downVoteCount: 0,
    version: 1,
    publishedAt: null,
  });

  const membership = Object.assign(new StorytimeArcStoryEntity(), {
    id: 'membership-1',
    arcId,
    storyId,
    orderIndex: 1000,
    membershipStatus: ArcMembershipStatus.INVITED,
    introductoryNote: null,
  });

  beforeEach(async () => {
    arcService = {
      findOwnedByUser: jest.fn().mockResolvedValue([arc]),
      findOwnedOrFail: jest.fn().mockResolvedValue(arc),
      create: jest.fn().mockResolvedValue(arc),
      update: jest.fn().mockResolvedValue(arc),
      publish: jest.fn().mockResolvedValue(arc),
      unpublish: jest.fn().mockResolvedValue(arc),
      remove: jest.fn().mockResolvedValue(undefined),
      setImage: jest.fn().mockResolvedValue(arc),
      clearImage: jest.fn().mockResolvedValue(arc),
    };
    membershipService = {
      findByArcForCurator: jest.fn().mockResolvedValue([membership]),
      findApprovedByArc: jest.fn().mockResolvedValue([membership]),
      invite: jest.fn().mockResolvedValue(membership),
      reorder: jest.fn().mockResolvedValue([membership]),
    };
    storyService = {
      findVisibleByIds: jest.fn().mockResolvedValue([
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          slug: 'a-story',
          title: 'A Story',
          upVoteCount: 0,
          downVoteCount: 0,
        }),
      ]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeCreatorArcsController],
      providers: [
        { provide: StorytimeArcService, useValue: arcService },
        {
          provide: StorytimeArcMembershipService,
          useValue: membershipService,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeArcMapper,
        StorytimeStoryMapper,
        StorytimeArcMembershipPresenter,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<StorytimeCreatorArcsController>(
      StorytimeCreatorArcsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the Arcs the caller curates', async () => {
    const result = await controller.findMine(userId);

    expect(result).toHaveLength(1);
    expect(arcService.findOwnedByUser).toHaveBeenCalledWith(userId);
  });

  it('retrieves an Arc for editing', async () => {
    const result = await controller.findOne(arcId, userId);

    expect(result.title).toBe('The Long War');
  });

  it('creates an Arc', async () => {
    await controller.create({ title: 'The Long War' }, userId);

    expect(arcService.create).toHaveBeenCalledWith(
      { title: 'The Long War' },
      userId,
    );
  });

  it('updates an Arc', async () => {
    await controller.update(arcId, { title: 'Renamed' }, userId);

    expect(arcService.update).toHaveBeenCalledWith(
      arcId,
      { title: 'Renamed' },
      userId,
    );
  });

  it('lists everything in the Arc, with the Stories it names', async () => {
    const result = await controller.findStories(arcId, userId);

    expect(result[0].story?.title).toBe('A Story');
    expect(result[0].membershipStatus).toBe(ArcMembershipStatus.INVITED);
  });

  // An Arc is usually assembled before the Stories in it are published, so the
  // titles are resolved for the curator rather than for the public: their own
  // draft appears under its name instead of as a Story nobody can see.
  it('names the Stories as the curator may see them', async () => {
    await controller.findStories(arcId, userId);

    expect(storyService.findVisibleByIds).toHaveBeenCalledWith(
      [storyId],
      userId,
    );
  });

  it('invites a Story', async () => {
    await controller.invite(arcId, { storyId }, userId);

    expect(membershipService.invite).toHaveBeenCalledWith(
      arcId,
      storyId,
      userId,
    );
  });

  it('reorders the reading order', async () => {
    await controller.reorder(arcId, { membershipIds: ['a', 'b'] }, userId);

    expect(membershipService.reorder).toHaveBeenCalledWith(
      arcId,
      ['a', 'b'],
      userId,
    );
  });

  // Publishing checks what has actually agreed to be in the Arc, so an Arc
  // full of unanswered invitations cannot be published.
  it('counts the agreed Stories when publishing', async () => {
    await controller.publish(arcId, userId);

    expect(membershipService.findApprovedByArc).toHaveBeenCalledWith(arcId);
    expect(arcService.publish).toHaveBeenCalledWith(arcId, userId, 1);
  });

  it('withdraws an Arc', async () => {
    await controller.unpublish(arcId, userId);

    expect(arcService.unpublish).toHaveBeenCalledWith(arcId, userId);
  });

  it('deletes an Arc', async () => {
    await controller.remove(arcId, userId);

    expect(arcService.remove).toHaveBeenCalledWith(arcId, userId);
  });

  describe('artwork', () => {
    const file = { originalname: 'banner.jpg' } as Express.Multer.File;

    it.each([
      ['setBannerImage', StorytimeImageSlot.ARC_BANNER],
      ['setProfileImage', StorytimeImageSlot.ARC_PROFILE],
    ] as const)(
      '%s passes the upload and its description on',
      async (method, slot) => {
        await controller[method](arcId, userId, file, {
          altText: 'A fleet at anchor',
        });

        expect(arcService.setImage).toHaveBeenCalledWith(
          arcId,
          userId,
          slot,
          file,
          'A fleet at anchor',
        );
      },
    );

    it.each([
      ['clearBannerImage', StorytimeImageSlot.ARC_BANNER],
      ['clearProfileImage', StorytimeImageSlot.ARC_PROFILE],
    ] as const)('%s asks for that slot to be emptied', async (method, slot) => {
      await controller[method](arcId, userId);

      expect(arcService.clearImage).toHaveBeenCalledWith(arcId, userId, slot);
    });

    it('complains when no file arrived', async () => {
      await expect(
        controller.setBannerImage(arcId, userId, undefined, {
          altText: 'A fleet',
        }),
      ).rejects.toThrow('An image file is required');

      expect(arcService.setImage).not.toHaveBeenCalled();
    });
  });

  describe('when creation is switched off', () => {
    beforeEach(() => {
      featureService.assertFlagEnabled.mockRejectedValue(
        new ForbiddenException(),
      );
    });

    it.each([
      ['findMine', () => controller.findMine(userId)],
      ['findOne', () => controller.findOne(arcId, userId)],
      ['create', () => controller.create({ title: 'X' }, userId)],
      ['update', () => controller.update(arcId, {}, userId)],
      ['findStories', () => controller.findStories(arcId, userId)],
      ['invite', () => controller.invite(arcId, { storyId }, userId)],
      [
        'reorder',
        () => controller.reorder(arcId, { membershipIds: ['a'] }, userId),
      ],
      ['publish', () => controller.publish(arcId, userId)],
      ['unpublish', () => controller.unpublish(arcId, userId)],
      ['remove', () => controller.remove(arcId, userId)],
      [
        'setBannerImage',
        () =>
          controller.setBannerImage(
            arcId,
            userId,
            { originalname: 'banner.jpg' } as Express.Multer.File,
            { altText: 'A fleet' },
          ),
      ],
      ['clearProfileImage', () => controller.clearProfileImage(arcId, userId)],
    ])('refuses %s', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
      expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
        STORYTIME_FEATURE_FLAGS.CREATION_ENABLED,
      );
    });
  });
});
