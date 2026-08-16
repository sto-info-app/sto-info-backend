import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { PublicStorytimeArcsController } from './public-storytime-arcs.controller';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';

describe('PublicStorytimeArcsController', () => {
  let controller: PublicStorytimeArcsController;
  let arcService: { findPublic: jest.Mock; findPublicBySlug: jest.Mock };
  let membershipService: { findApprovedByArc: jest.Mock };
  let storyService: { findPublicByIds: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const arc = Object.assign(new StorytimeArcEntity(), {
    id: 'arc-1',
    slug: 'the-long-war',
    title: 'The Long War',
    ownerUserId: 'curator-1',
    shortDescription: null,
    descriptionHtml: null,
    languageCode: 'en',
    bannerImageId: null,
    profileImageId: null,
    status: ArcStatus.PUBLISHED,
    visibility: StorytimeVisibility.PUBLIC,
    upVoteCount: 0,
    downVoteCount: 0,
    publishedAt: null,
  });

  /**
   * Builds an approved membership.
   *
   * @param storyId - The Story it names.
   * @returns The membership entity.
   */
  const buildMembership = (storyId: string) =>
    Object.assign(new StorytimeArcStoryEntity(), {
      id: `membership-${storyId}`,
      arcId: 'arc-1',
      storyId,
      orderIndex: 1000,
      membershipStatus: ArcMembershipStatus.APPROVED,
      introductoryNote: null,
    });

  /**
   * Builds a readable Story.
   *
   * @param id - The Story identifier.
   * @returns The Story entity.
   */
  const buildStory = (id: string) =>
    Object.assign(new StorytimeStoryEntity(), {
      id,
      slug: id,
      title: `Story ${id}`,
      upVoteCount: 0,
      downVoteCount: 0,
    });

  beforeEach(async () => {
    arcService = {
      findPublic: jest.fn().mockResolvedValue([arc]),
      findPublicBySlug: jest.fn().mockResolvedValue(arc),
    };
    membershipService = {
      findApprovedByArc: jest
        .fn()
        .mockResolvedValue([buildMembership('story-1')]),
    };
    storyService = {
      findPublicByIds: jest.fn().mockResolvedValue([buildStory('story-1')]),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeArcsController],
      providers: [
        { provide: StorytimeArcService, useValue: arcService },
        {
          provide: StorytimeArcMembershipService,
          useValue: membershipService,
        },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeArcMapper,
        StorytimeStoryMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeArcsController>(
      PublicStorytimeArcsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists published Arcs', async () => {
    const result = await controller.findAll();

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('The Long War');
  });

  it('reads one Arc with its Stories', async () => {
    const result = await controller.findOne('the-long-war');

    expect(result.arc.title).toBe('The Long War');
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0].story?.title).toBe('Story story-1');
  });

  // A curator may assemble an Arc around Stories that are not out yet, but a
  // reader should never be shown a step in a reading order they cannot take.
  it('hides a Story a reader could not open', async () => {
    membershipService.findApprovedByArc.mockResolvedValue([
      buildMembership('story-1'),
      buildMembership('story-unpublished'),
    ]);

    const result = await controller.findOne('the-long-war');

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0].storyId).toBe('story-1');
  });

  it('shows an empty reading order when none of its Stories are out yet', async () => {
    storyService.findPublicByIds.mockResolvedValue([]);

    const result = await controller.findOne('the-long-war');

    expect(result.stories).toEqual([]);
    expect(result.arc.title).toBe('The Long War');
  });

  it('refuses when no readable Arc matches', async () => {
    arcService.findPublicBySlug.mockResolvedValue(null);

    await expect(controller.findOne('the-long-war')).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    ['findAll', () => controller.findAll()],
    ['findOne', () => controller.findOne('the-long-war')],
  ])('refuses %s when reading is switched off', async (_name, act) => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(act()).rejects.toThrow(ForbiddenException);
  });
});
