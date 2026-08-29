import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { StorytimeCommentStatus } from '../enums/storytime-comment-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';
import { StorytimeCommentMapper } from './storytime-comment.mapper';
import { StorytimeCommentService } from './storytime-comment.service';
import { StorytimeCommentsController } from './storytime-comments.controller';
import { StorytimeAuthorService } from '../shared/storytime-author.service';

describe('StorytimeCommentsController', () => {
  let controller: StorytimeCommentsController;
  let commentService: {
    findFor: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteOwn: jest.Mock;
    hide: jest.Mock;
    unhide: jest.Mock;
    removeAsAdmin: jest.Mock;
  };

  let authorService: { findAuthors: jest.Mock };

  const userId = 'reader-1';
  const storyId = 'story-1';
  const commentId = 'comment-1';

  const comment = Object.assign(new StorytimeCommentEntity(), {
    id: commentId,
    targetType: StorytimeTargetType.STORY,
    targetId: storyId,
    authorUserId: userId,
    parentCommentId: null,
    body: 'A fine chapter.',
    status: StorytimeCommentStatus.VISIBLE,
    editedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
  });

  beforeEach(async () => {
    commentService = {
      findFor: jest.fn().mockResolvedValue([comment]),
      create: jest.fn().mockResolvedValue(comment),
      update: jest.fn().mockResolvedValue(comment),
      deleteOwn: jest.fn().mockResolvedValue(comment),
      hide: jest.fn().mockResolvedValue(comment),
      unhide: jest.fn().mockResolvedValue(comment),
      removeAsAdmin: jest.fn().mockResolvedValue(comment),
    };

    authorService = {
      findAuthors: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [userId, { username: 'captain.picard', publiclyVisible: true }],
          ]),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeCommentsController],
      providers: [
        { provide: StorytimeCommentService, useValue: commentService },
        StorytimeCommentMapper,
        { provide: StorytimeAuthorService, useValue: authorService },
        // The permissions guard declared on the controller needs this to be
        // constructible. Its behaviour is covered by its own spec.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<StorytimeCommentsController>(
      StorytimeCommentsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('reads a conversation', async () => {
    const comments = await controller.findFor(
      StorytimeTargetType.STORY,
      storyId,
      userId,
    );

    expect(comments).toHaveLength(1);
    expect(commentService.findFor).toHaveBeenCalledWith(
      StorytimeTargetType.STORY,
      storyId,
    );
  });

  // A comment that does not say who wrote it is half a comment.
  it('names everybody in the conversation, in one lookup', async () => {
    const comments = await controller.findFor(
      StorytimeTargetType.STORY,
      storyId,
      userId,
    );

    expect(comments[0].author).toEqual({
      username: 'captain.picard',
      publiclyVisible: true,
    });
    expect(authorService.findAuthors).toHaveBeenCalledTimes(1);
  });

  // The work outlives the account behind it; the comment simply stops saying
  // whose it was.
  it('leaves a comment unnamed when the account has gone', async () => {
    authorService.findAuthors.mockResolvedValue(new Map());

    const comments = await controller.findFor(
      StorytimeTargetType.STORY,
      storyId,
      userId,
    );

    expect(comments[0].author).toBeNull();
  });

  // Reading a conversation needs no account. The reader arrives as null rather
  // than absent, because that is what `OptionalUserId` hands a route when
  // nobody is signed in.
  it('reads a conversation for a signed-out reader', async () => {
    const comments = await controller.findFor(
      StorytimeTargetType.STORY,
      storyId,
      null,
    );

    expect(comments[0].body).toBe('A fine chapter.');
  });

  it('posts a comment', async () => {
    await controller.create(
      {
        targetType: StorytimeTargetType.STORY,
        targetId: storyId,
        body: 'A fine chapter.',
      },
      userId,
    );

    expect(commentService.create).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: storyId }),
      userId,
    );
  });

  it('edits a comment', async () => {
    await controller.update(commentId, { body: 'Actually, two.' }, userId);

    expect(commentService.update).toHaveBeenCalledWith(
      commentId,
      'Actually, two.',
      userId,
    );
  });

  it('takes a comment back', async () => {
    await controller.remove(commentId, userId);

    expect(commentService.deleteOwn).toHaveBeenCalledWith(commentId, userId);
  });

  it.each([
    ['hide', 'hide'],
    ['unhide', 'unhide'],
  ])('%ss a comment', async (_name, method) => {
    const act = controller[method as 'hide' | 'unhide'].bind(controller);

    await act(commentId, userId);

    expect(commentService[method as 'hide' | 'unhide']).toHaveBeenCalledWith(
      commentId,
      userId,
    );
  });

  it('removes a comment under the content policy', async () => {
    await controller.removeAsAdmin(
      commentId,
      { message: 'This breaches the harassment policy.' },
      'admin-1',
    );

    expect(commentService.removeAsAdmin).toHaveBeenCalledWith(
      commentId,
      'This breaches the harassment policy.',
      'admin-1',
    );
  });

  it('passes on a refusal to touch somebody else’s comment', async () => {
    commentService.update.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.update(commentId, { body: 'Nope.' }, 'stranger-1'),
    ).rejects.toThrow(ForbiddenException);
  });
});
