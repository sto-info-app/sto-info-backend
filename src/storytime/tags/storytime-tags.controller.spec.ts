import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { StorytimeArcService } from '../arcs/storytime-arc.service';
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
import { StoryCapability } from '../collaboration/storytime-story-capability.enum';
import { StorytimeTagCategory } from '../enums/storytime-tag-category.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagMapper } from './storytime-tag.mapper';
import { StorytimeTagService } from './storytime-tag.service';
import { StorytimeTaggingService } from './storytime-tagging.service';
import { StorytimeTagsController } from './storytime-tags.controller';

describe('StorytimeTagsController', () => {
  let controller: StorytimeTagsController;
  let tagService: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let taggingService: { findFor: jest.Mock; setTags: jest.Mock };
  let storyService: { findEditableOrFail: jest.Mock };
  let arcService: { findEditableOrFail: jest.Mock };

  const userId = 'user-1';
  const storyId = 'story-1';
  const arcId = 'arc-1';
  const tagId = 'tag-1';

  const tag = Object.assign(new StorytimeTagEntity(), {
    id: tagId,
    slug: 'klingon',
    name: 'Klingon',
    description: null,
    category: StorytimeTagCategory.FACTION,
    displayOrder: 0,
  });

  beforeEach(async () => {
    tagService = {
      findAll: jest.fn().mockResolvedValue([tag]),
      create: jest.fn().mockResolvedValue(tag),
      update: jest.fn().mockResolvedValue(tag),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    taggingService = {
      findFor: jest.fn().mockResolvedValue([tag]),
      setTags: jest.fn().mockResolvedValue([tag]),
    };
    storyService = { findEditableOrFail: jest.fn().mockResolvedValue({}) };
    arcService = { findEditableOrFail: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeTagsController],
      providers: [
        { provide: StorytimeTagService, useValue: tagService },
        { provide: StorytimeTaggingService, useValue: taggingService },
        { provide: StorytimeStoryService, useValue: storyService },
        { provide: StorytimeArcService, useValue: arcService },
        StorytimeTagMapper,
        // The permissions guard declared on the controller needs this to be
        // constructible. Its behaviour is covered by its own spec.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<StorytimeTagsController>(StorytimeTagsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists the vocabulary', async () => {
    const tags = await controller.findAll();

    expect(tags[0].name).toBe('Klingon');
    expect(tagService.findAll).toHaveBeenCalledWith(undefined);
  });

  it('lists one category', async () => {
    await controller.findAll(StorytimeTagCategory.GENRE);

    expect(tagService.findAll).toHaveBeenCalledWith(StorytimeTagCategory.GENRE);
  });

  it('reads the tags on a Story', async () => {
    await controller.findStoryTags(storyId);

    expect(taggingService.findFor).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
    );
  });

  it('reads the tags on an Arc', async () => {
    await controller.findArcTags(arcId);

    expect(taggingService.findFor).toHaveBeenCalledWith(
      StorytimeTargetType.ARC,
      arcId,
    );
  });

  // Tagging a Story is editing it, so it needs what editing needs rather than
  // a rule of its own.
  it('checks the caller may edit the Story before tagging it', async () => {
    await controller.setStoryTags(storyId, { tagIds: [tagId] }, userId);

    expect(storyService.findEditableOrFail).toHaveBeenCalledWith(
      storyId,
      userId,
      StoryCapability.EDIT_STORY,
    );
    expect(taggingService.setTags).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
      [tagId],
    );
  });

  it('refuses to tag a Story the caller may not edit', async () => {
    storyService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.setStoryTags(storyId, { tagIds: [tagId] }, userId),
    ).rejects.toThrow(ForbiddenException);
    expect(taggingService.setTags).not.toHaveBeenCalled();
  });

  it('checks the caller may edit the Arc before tagging it', async () => {
    await controller.setArcTags(arcId, { tagIds: [tagId] }, userId);

    expect(arcService.findEditableOrFail).toHaveBeenCalledWith(
      arcId,
      userId,
      ArcCapability.EDIT_ARC,
    );
  });

  it('refuses to tag an Arc the caller may not edit', async () => {
    arcService.findEditableOrFail.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.setArcTags(arcId, { tagIds: [tagId] }, userId),
    ).rejects.toThrow(ForbiddenException);
    expect(taggingService.setTags).not.toHaveBeenCalled();
  });

  it('adds a tag to the vocabulary', async () => {
    await controller.create(
      { name: 'Klingon', category: StorytimeTagCategory.FACTION },
      userId,
    );

    expect(tagService.create).toHaveBeenCalledWith(
      { name: 'Klingon', category: StorytimeTagCategory.FACTION },
      userId,
    );
  });

  it('changes a tag', async () => {
    await controller.update(tagId, { name: 'Klingon Empire' }, userId);

    expect(tagService.update).toHaveBeenCalledWith(
      tagId,
      { name: 'Klingon Empire' },
      userId,
    );
  });

  it('removes a tag', async () => {
    await controller.remove(tagId, userId);

    expect(tagService.remove).toHaveBeenCalledWith(tagId, userId);
  });

  it('reports a tag that is not there', async () => {
    tagService.update.mockRejectedValue(new NotFoundException());

    await expect(controller.update(tagId, {}, userId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
