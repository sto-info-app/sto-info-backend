import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ArcMembershipStatus } from '../enums/arc-membership-status.enum';
import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeTagEntity } from '../tags/entities/storytime-tag.entity';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { StorytimeTaggingService } from '../tags/storytime-tagging.service';
import { StorytimeArcStoryEntity } from './entities/storytime-arc-story.entity';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { PublicStorytimeArcsController } from './public-storytime-arcs.controller';
import { StorytimeArcMembershipService } from './storytime-arc-membership.service';
import { StorytimeArcProgressService } from './storytime-arc-progress.service';
import { StorytimeArcMapper } from './storytime-arc.mapper';
import { StorytimeArcService } from './storytime-arc.service';

describe('PublicStorytimeArcsController', () => {
  let controller: PublicStorytimeArcsController;
  let arcService: { findPublic: jest.Mock; findPublicBySlug: jest.Mock };
  let membershipService: { findApprovedByArc: jest.Mock };
  let storyService: { findPublicByIds: jest.Mock };
  let arcProgressService: { summarise: jest.Mock };
  let taggingService: { findFor: jest.Mock; findForMany: jest.Mock };
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

  const tag = Object.assign(new StorytimeTagEntity(), {
    id: 'tag-1',
    slug: 'war',
    name: 'War',
    description: null,
    category: 'THEME',
    displayOrder: 0,
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
    arcProgressService = {
      summarise: jest.fn().mockResolvedValue({
        arcId: 'arc-1',
        totalStories: 1,
        completedStories: 0,
        percentComplete: 0,
        continueStoryId: 'story-1',
        continueChapterId: null,
      }),
    };
    taggingService = {
      findFor: jest.fn().mockResolvedValue([tag]),
      findForMany: jest.fn().mockResolvedValue(new Map([['story-1', [tag]]])),
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
        { provide: StorytimeTaggingService, useValue: taggingService },
        StorytimeTagMapper,
        { provide: StorytimeArcProgressService, useValue: arcProgressService },
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

  // The Arc listing says what each Arc is about, the way the Story listing
  // and the Spotlight panel do.
  it('names what each listed Arc is tagged with', async () => {
    taggingService.findForMany.mockResolvedValue(new Map([['arc-1', [tag]]]));

    const result = await controller.findAll();

    expect(taggingService.findForMany).toHaveBeenCalledWith('ARC', ['arc-1']);
    expect(result[0].tags.map(each => each.name)).toEqual(['War']);
  });

  it('leaves an untagged Arc with no tags rather than none of the listing', async () => {
    taggingService.findForMany.mockResolvedValue(new Map());

    const result = await controller.findAll();

    expect(result[0].tags).toEqual([]);
  });

  it('names what an Arc and the Stories in it are tagged with', async () => {
    const result = await controller.findOne('the-long-war');

    expect(taggingService.findFor).toHaveBeenCalledWith('ARC', 'arc-1');
    expect(result.arc.tags.map(each => each.name)).toEqual(['War']);
    expect(result.stories[0].story?.tags.map(each => each.name)).toEqual([
      'War',
    ]);
  });

  // The reading order should still list a Story that nobody has tagged yet,
  // rather than dropping it or failing the whole Arc.
  it('leaves an untagged Story in the reading order with no tags', async () => {
    taggingService.findForMany.mockResolvedValue(new Map());

    const result = await controller.findOne('the-long-war');

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0].story?.tags).toEqual([]);
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

  describe('progress through an Arc', () => {
    it('reports how far the reader has got', async () => {
      const result = await controller.findProgress('the-long-war', 'user-1');

      expect(result.totalStories).toBe(1);
      expect(result.continueStoryId).toBe('story-1');
    });

    // "Continue" should follow the reading order the curator set, not whatever
    // order the Story lookup happened to return.
    it('counts the Stories in the Arc’s own order', async () => {
      membershipService.findApprovedByArc.mockResolvedValue([
        buildMembership('story-2'),
        buildMembership('story-1'),
      ]);
      storyService.findPublicByIds.mockResolvedValue([
        buildStory('story-1'),
        buildStory('story-2'),
      ]);

      await controller.findProgress('the-long-war', 'user-1');

      const ordered = arcProgressService.summarise.mock.calls[0][2];
      expect(ordered.map((story: { id: string }) => story.id)).toEqual([
        'story-2',
        'story-1',
      ]);
    });

    // A membership naming a Story that is not out yet is a real agreement, but
    // it cannot count towards progress a reader can make.
    it('leaves out a Story the reader could not open', async () => {
      membershipService.findApprovedByArc.mockResolvedValue([
        buildMembership('story-1'),
        buildMembership('story-unpublished'),
      ]);

      await controller.findProgress('the-long-war', 'user-1');

      expect(arcProgressService.summarise.mock.calls[0][2]).toHaveLength(1);
    });

    it('refuses when no readable Arc matches', async () => {
      arcService.findPublicBySlug.mockResolvedValue(null);

      await expect(
        controller.findProgress('the-long-war', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it.each([
    ['findAll', () => controller.findAll()],
    ['findOne', () => controller.findOne('the-long-war')],
    ['findProgress', () => controller.findProgress('the-long-war', 'user-1')],
  ])('refuses %s when reading is switched off', async (_name, act) => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(act()).rejects.toThrow(ForbiddenException);
  });
});
