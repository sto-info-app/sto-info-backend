import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeArcFollowEntity } from './entities/storytime-arc-follow.entity';
import { StorytimeCreatorFollowEntity } from './entities/storytime-creator-follow.entity';
import { StorytimeStoryFollowEntity } from './entities/storytime-story-follow.entity';
import {
  FollowTargetKind,
  StorytimeFollowService,
} from './storytime-follow.service';

describe('StorytimeFollowService', () => {
  let service: StorytimeFollowService;
  let creatorRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    insert: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  let storyRepository: typeof creatorRepository;
  let arcRepository: typeof creatorRepository;

  const readerId = 'reader-1';

  /**
   * Builds a follow-table stub.
   *
   * @returns The stub.
   */
  const buildRepository = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  });

  beforeEach(async () => {
    creatorRepository = buildRepository();
    storyRepository = buildRepository();
    arcRepository = buildRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeFollowService,
        {
          provide: getRepositoryToken(StorytimeCreatorFollowEntity),
          useValue: creatorRepository,
        },
        {
          provide: getRepositoryToken(StorytimeStoryFollowEntity),
          useValue: storyRepository,
        },
        {
          provide: getRepositoryToken(StorytimeArcFollowEntity),
          useValue: arcRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeFollowService>(StorytimeFollowService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it.each([
    [
      'a creator',
      FollowTargetKind.CREATOR,
      'creatorUserId',
      () => creatorRepository,
    ],
    ['a Story', FollowTargetKind.STORY, 'storyId', () => storyRepository],
    ['an Arc', FollowTargetKind.ARC, 'arcId', () => arcRepository],
  ])('follows %s', async (_name, kind, column, repository) => {
    await expect(service.follow(kind, 'target-1', readerId)).resolves.toBe(
      true,
    );

    expect(repository().insert).toHaveBeenCalledWith({
      userId: readerId,
      [column]: 'target-1',
    });
  });

  // Pressing the button twice is not two follows.
  it('changes nothing when already following', async () => {
    storyRepository.findOne.mockResolvedValue({ id: 'follow-1' });

    await expect(
      service.follow(FollowTargetKind.STORY, 'story-1', readerId),
    ).resolves.toBe(true);
    expect(storyRepository.insert).not.toHaveBeenCalled();
  });

  // Following yourself would fill your own feed with the one thing you
  // already know about.
  it('refuses to let somebody follow themselves', async () => {
    await expect(
      service.follow(FollowTargetKind.CREATOR, readerId, readerId),
    ).rejects.toThrow(BadRequestException);
  });

  it('unfollows something', async () => {
    await expect(
      service.unfollow(FollowTargetKind.STORY, 'story-1', readerId),
    ).resolves.toBe(false);

    expect(storyRepository.delete).toHaveBeenCalledWith({
      userId: readerId,
      storyId: 'story-1',
    });
  });

  // A button that reports failure for saying what is already true teaches
  // people to distrust it.
  it('does not complain about unfollowing something it does not follow', async () => {
    await expect(
      service.unfollow(FollowTargetKind.ARC, 'arc-1', readerId),
    ).resolves.toBe(false);
  });

  it('reports whether somebody follows something', async () => {
    storyRepository.findOne.mockResolvedValue({ id: 'follow-1' });

    await expect(
      service.isFollowing(FollowTargetKind.STORY, 'story-1', readerId),
    ).resolves.toBe(true);
    await expect(
      service.isFollowing(FollowTargetKind.ARC, 'arc-1', readerId),
    ).resolves.toBe(false);
  });

  it('lists everything a reader follows', async () => {
    creatorRepository.find.mockResolvedValue([{ creatorUserId: 'writer-1' }]);
    storyRepository.find.mockResolvedValue([{ storyId: 'story-1' }]);
    arcRepository.find.mockResolvedValue([{ arcId: 'arc-1' }]);

    const follows = await service.findFollows(readerId);

    expect(follows).toEqual({
      creatorUserIds: ['writer-1'],
      storyIds: ['story-1'],
      arcIds: ['arc-1'],
    });
  });

  it('counts the followers of something', async () => {
    storyRepository.count.mockResolvedValue(3);

    await expect(
      service.countFollowers(FollowTargetKind.STORY, 'story-1'),
    ).resolves.toBe(3);
  });

  it.each([
    [StorytimeTargetType.STORY, FollowTargetKind.STORY],
    [StorytimeTargetType.ARC, FollowTargetKind.ARC],
  ])('names the kind of follow matching a %s', (targetType, expected) => {
    expect(service.kindFor(targetType)).toBe(expected);
  });

  it.each([
    StorytimeTargetType.CHAPTER,
    StorytimeTargetType.CHARACTER,
    StorytimeTargetType.COMMENT,
  ])('refuses to follow a %s', targetType => {
    expect(() => service.kindFor(targetType)).toThrow(BadRequestException);
  });
});
