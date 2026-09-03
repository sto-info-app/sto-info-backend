import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryService } from '../stories/storytime-story.service';
import { StorytimeFeatureService } from '../storytime-feature.service';
import { StorytimeCrewCreditEntity } from './entities/storytime-crew-credit.entity';
import { StorytimeCrewRoleEntity } from './entities/storytime-crew-role.entity';
import { PublicStorytimeCrewController } from './public-storytime-crew.controller';
import { StorytimeCrewCreditService } from './storytime-crew-credit.service';
import { StorytimeCrewMapper } from './storytime-crew.mapper';

describe('PublicStorytimeCrewController', () => {
  let controller: PublicStorytimeCrewController;
  let roleRepository: { find: jest.Mock };
  let creditService: { findByStory: jest.Mock; findRolesByIds: jest.Mock };
  let storyService: { findPublicBySlug: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  const role = Object.assign(new StorytimeCrewRoleEntity(), {
    id: 'role-1',
    code: 'NARRATOR',
    name: 'Narrator',
    description: null,
    displayOrder: 7000,
  });

  const credit = Object.assign(new StorytimeCrewCreditEntity(), {
    id: 'credit-1',
    storyId: 'story-1',
    chapterId: null,
    characterId: null,
    userId: 'member-1',
    roleId: 'role-1',
    creditLabel: null,
    notes: null,
    orderIndex: 1000,
  });

  beforeEach(async () => {
    roleRepository = { find: jest.fn().mockResolvedValue([role]) };
    creditService = {
      findByStory: jest.fn().mockResolvedValue([credit]),
      findRolesByIds: jest.fn().mockResolvedValue([role]),
    };
    storyService = {
      findPublicBySlug: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: 'story-1',
          slug: 'a-story',
        }),
      ),
    };
    featureService = {
      assertFlagEnabled: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicStorytimeCrewController],
      providers: [
        {
          provide: getRepositoryToken(StorytimeCrewRoleEntity),
          useValue: roleRepository,
        },
        { provide: StorytimeCrewCreditService, useValue: creditService },
        { provide: StorytimeStoryService, useValue: storyService },
        StorytimeCrewMapper,
        { provide: StorytimeFeatureService, useValue: featureService },
      ],
    }).compile();

    controller = module.get<PublicStorytimeCrewController>(
      PublicStorytimeCrewController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  // The roles are a taxonomy, not a secret: a client needs them both to render
  // a credits roll and to offer them when adding one.
  it('lists the roles in credits-roll order', async () => {
    const result = await controller.findRoles();

    expect(result[0].name).toBe('Narrator');
    expect(roleRepository.find).toHaveBeenCalledWith({
      order: { displayOrder: 'ASC' },
    });
  });

  it('reads a published Story’s credits', async () => {
    const result = await controller.findCredits('a-story');

    expect(result).toHaveLength(1);
    expect(result[0].displayLabel).toBe('Narrator');
  });

  // Credits hang off a Story, so the Story being readable is what keeps a
  // private Story's credits private.
  it('refuses credits when no readable Story matches', async () => {
    storyService.findPublicBySlug.mockResolvedValue(null);

    await expect(controller.findCredits('a-story')).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    ['findRoles', () => controller.findRoles()],
    ['findCredits', () => controller.findCredits('a-story')],
  ])('refuses %s when reading is switched off', async (_name, act) => {
    featureService.assertFlagEnabled.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(act()).rejects.toThrow(ForbiddenException);
  });
});
