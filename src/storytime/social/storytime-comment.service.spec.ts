import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeArcEntity } from '../arcs/entities/storytime-arc.entity';
import { StorytimeChapterEntity } from '../chapters/entities/storytime-chapter.entity';
import { StorytimeCommentStatus } from '../enums/storytime-comment-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';
import { StorytimeCommentService } from './storytime-comment.service';

describe('StorytimeCommentService', () => {
  let service: StorytimeCommentService;
  let commentRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
  };
  let storyRepository: { findOne: jest.Mock };
  let chapterRepository: { findOne: jest.Mock };
  let arcRepository: { findOne: jest.Mock };

  const authorId = 'reader-1';
  const ownerId = 'writer-1';
  const adminId = 'admin-1';
  const strangerId = 'stranger-1';
  const storyId = 'story-1';
  const commentId = 'comment-1';

  /**
   * Builds a comment.
   *
   * @param overrides - Fields to change.
   * @returns The comment.
   */
  const buildComment = (
    overrides: Partial<StorytimeCommentEntity> = {},
  ): StorytimeCommentEntity =>
    Object.assign(new StorytimeCommentEntity(), {
      id: commentId,
      targetType: StorytimeTargetType.STORY,
      targetId: storyId,
      authorUserId: authorId,
      parentCommentId: null,
      body: 'A fine chapter.',
      status: StorytimeCommentStatus.VISIBLE,
      editedAt: null,
      moderationMessage: null,
      moderatedByUserId: null,
      moderatedAt: null,
      ...overrides,
    });

  /** A comment request. */
  const request = {
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    body: 'A fine chapter.',
  };

  beforeEach(async () => {
    commentRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input =>
        Object.assign(new StorytimeCommentEntity(), input),
      ),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
    };
    storyRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeStoryEntity(), {
          id: storyId,
          ownerUserId: ownerId,
        }),
      ),
    };
    chapterRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeChapterEntity(), {
          id: 'chapter-1',
          storyId,
        }),
      ),
    };
    arcRepository = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new StorytimeArcEntity(), {
          id: 'arc-1',
          ownerUserId: 'curator-1',
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeCommentService,
        {
          provide: getRepositoryToken(StorytimeCommentEntity),
          useValue: commentRepository,
        },
        {
          provide: getRepositoryToken(StorytimeStoryEntity),
          useValue: storyRepository,
        },
        {
          provide: getRepositoryToken(StorytimeChapterEntity),
          useValue: chapterRepository,
        },
        {
          provide: getRepositoryToken(StorytimeArcEntity),
          useValue: arcRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeCommentService>(StorytimeCommentService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('posting', () => {
    it('records what was said', async () => {
      const comment = await service.create(request, authorId);

      expect(comment.body).toBe('A fine chapter.');
      expect(comment.authorUserId).toBe(authorId);
      expect(comment.status).toBe(StorytimeCommentStatus.VISIBLE);
    });

    it('posts a reply to a comment', async () => {
      commentRepository.findOne.mockResolvedValue(buildComment());

      const reply = await service.create(
        { ...request, parentCommentId: commentId },
        authorId,
      );

      expect(reply.parentCommentId).toBe(commentId);
    });

    // A thread that nests indefinitely becomes unreadable on a phone and
    // unmoderatable anywhere.
    it('refuses a reply to a reply', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({ id: 'comment-2', parentCommentId: commentId }),
      );

      await expect(
        service.create({ ...request, parentCommentId: 'comment-2' }, authorId),
      ).rejects.toThrow(/one level deep/);
    });

    it('refuses a reply to a comment on something else', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({ targetId: 'another-story' }),
      );

      await expect(
        service.create({ ...request, parentCommentId: commentId }, authorId),
      ).rejects.toThrow(/belongs to something else/);
    });

    it('reports a parent that is not there', async () => {
      await expect(
        service.create({ ...request, parentCommentId: 'missing' }, authorId),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      StorytimeTargetType.CHARACTER,
      StorytimeTargetType.CREW_CREDIT,
      StorytimeTargetType.SPOTLIGHT,
    ])('refuses to comment on a %s', async targetType => {
      await expect(
        service.create({ ...request, targetType }, authorId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('editing', () => {
    beforeEach(() => {
      commentRepository.findOne.mockResolvedValue(buildComment());
    });

    it('changes what it says and records when', async () => {
      const edited = await service.update(
        commentId,
        'Actually, two.',
        authorId,
      );

      expect(edited.body).toBe('Actually, two.');
      expect(edited.editedAt).toBeInstanceOf(Date);
    });

    it('refuses somebody else’s comment', async () => {
      await expect(
        service.update(commentId, 'Nope.', strangerId),
      ).rejects.toThrow(ForbiddenException);
    });

    // Editing a comment an administrator removed would let somebody rewrite
    // what was moderated.
    it.each([
      StorytimeCommentStatus.REMOVED_BY_ADMIN,
      StorytimeCommentStatus.HIDDEN_BY_OWNER,
      StorytimeCommentStatus.DELETED_BY_AUTHOR,
    ])('refuses to edit one that is %s', async status => {
      commentRepository.findOne.mockResolvedValue(buildComment({ status }));

      await expect(
        service.update(commentId, 'Nope.', authorId),
      ).rejects.toThrow(/no longer be edited/);
    });
  });

  describe('an author taking a comment back', () => {
    beforeEach(() => {
      commentRepository.findOne.mockResolvedValue(buildComment());
    });

    it('marks it as taken back rather than deleting it', async () => {
      const deleted = await service.deleteOwn(commentId, authorId);

      expect(deleted.status).toBe(StorytimeCommentStatus.DELETED_BY_AUTHOR);
      expect(deleted.moderatedAt).toBeInstanceOf(Date);
    });

    it('refuses somebody else’s comment', async () => {
      await expect(service.deleteOwn(commentId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('an owner tidying their own page', () => {
    beforeEach(() => {
      commentRepository.findOne.mockResolvedValue(buildComment());
    });

    it('hides a comment on their Story', async () => {
      const hidden = await service.hide(commentId, ownerId);

      expect(hidden.status).toBe(StorytimeCommentStatus.HIDDEN_BY_OWNER);
    });

    // A Chapter has no owner of its own, so its Story's owner tidies it.
    it('hides a comment on their Chapter', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({
          targetType: StorytimeTargetType.CHAPTER,
          targetId: 'chapter-1',
        }),
      );

      await expect(service.hide(commentId, ownerId)).resolves.toBeDefined();
    });

    it('hides a comment on their Arc', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({
          targetType: StorytimeTargetType.ARC,
          targetId: 'arc-1',
        }),
      );

      await expect(service.hide(commentId, 'curator-1')).resolves.toBeDefined();
    });

    it('refuses somebody who does not own the content', async () => {
      await expect(service.hide(commentId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      ['a Story', StorytimeTargetType.STORY, () => storyRepository],
      ['an Arc', StorytimeTargetType.ARC, () => arcRepository],
      ['a Chapter', StorytimeTargetType.CHAPTER, () => chapterRepository],
    ])('refuses when %s has gone', async (_name, targetType, repository) => {
      commentRepository.findOne.mockResolvedValue(buildComment({ targetType }));
      repository().findOne.mockResolvedValue(null);

      await expect(service.hide(commentId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses when a Chapter’s Story has gone', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({ targetType: StorytimeTargetType.CHAPTER }),
      );
      storyRepository.findOne.mockResolvedValue(null);

      await expect(service.hide(commentId, ownerId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('puts a hidden comment back', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({ status: StorytimeCommentStatus.HIDDEN_BY_OWNER }),
      );

      const shown = await service.unhide(commentId, ownerId);

      expect(shown.status).toBe(StorytimeCommentStatus.VISIBLE);
      expect(shown.moderatedByUserId).toBeNull();
    });

    // The difference between tidying and moderating: what an administrator
    // removed is not an owner's to restore.
    it('refuses to unhide what an administrator removed', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({ status: StorytimeCommentStatus.REMOVED_BY_ADMIN }),
      );

      await expect(service.unhide(commentId, ownerId)).rejects.toThrow(
        /not hidden by you/,
      );
    });

    it('refuses to unhide for somebody who does not own the content', async () => {
      commentRepository.findOne.mockResolvedValue(
        buildComment({ status: StorytimeCommentStatus.HIDDEN_BY_OWNER }),
      );

      await expect(service.unhide(commentId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('an administrator removing a comment', () => {
    it('records what the author is told', async () => {
      commentRepository.findOne.mockResolvedValue(buildComment());

      const removed = await service.removeAsAdmin(
        commentId,
        'This breaches the harassment policy.',
        adminId,
      );

      expect(removed.status).toBe(StorytimeCommentStatus.REMOVED_BY_ADMIN);
      expect(removed.moderationMessage).toContain('harassment policy');
      expect(removed.moderatedByUserId).toBe(adminId);
    });

    it('reports a comment that is not there', async () => {
      await expect(
        service.removeAsAdmin(commentId, 'Gone.', adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reading', () => {
    // A reply to a removed comment still needs somewhere to hang, so nothing
    // is filtered out here.
    it('reads the whole conversation, oldest first', async () => {
      await service.findFor(StorytimeTargetType.STORY, storyId);

      expect(commentRepository.find).toHaveBeenCalledWith({
        where: { targetType: StorytimeTargetType.STORY, targetId: storyId },
        order: { createdAt: 'ASC' },
      });
    });

    it('counts only what is shown', async () => {
      await service.countVisible(StorytimeTargetType.STORY, storyId);

      expect(commentRepository.count).toHaveBeenCalledWith({
        where: {
          targetType: StorytimeTargetType.STORY,
          targetId: storyId,
          status: StorytimeCommentStatus.VISIBLE,
        },
      });
    });

    it('reports a comment that is not there', async () => {
      await expect(service.findOneOrFail(commentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
