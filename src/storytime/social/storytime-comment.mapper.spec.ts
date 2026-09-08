import { Test, TestingModule } from '@nestjs/testing';

import { StorytimeCommentStatus } from '../enums/storytime-comment-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeCommentEntity } from './entities/storytime-comment.entity';
import { StorytimeCommentMapper } from './storytime-comment.mapper';

describe('StorytimeCommentMapper', () => {
  let mapper: StorytimeCommentMapper;

  const authorId = 'reader-1';

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
      id: 'comment-1',
      targetType: StorytimeTargetType.STORY,
      targetId: 'story-1',
      authorUserId: authorId,
      parentCommentId: null,
      body: 'A fine chapter.',
      status: StorytimeCommentStatus.VISIBLE,
      editedAt: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      ...overrides,
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeCommentMapper],
    }).compile();

    mapper = module.get<StorytimeCommentMapper>(StorytimeCommentMapper);
  });

  it('maps a visible comment', () => {
    const mapped = mapper.toComment(buildComment());

    expect(mapped.body).toBe('A fine chapter.');
    expect(mapped.status).toBe(StorytimeCommentStatus.VISIBLE);
  });

  // A silenced comment keeps its place in the thread but not its words.
  it.each([
    StorytimeCommentStatus.DELETED_BY_AUTHOR,
    StorytimeCommentStatus.HIDDEN_BY_OWNER,
    StorytimeCommentStatus.REMOVED_BY_ADMIN,
  ])('withholds the words of one that is %s', status => {
    const mapped = mapper.toComment(buildComment({ status }), 'somebody-else');

    expect(mapped.body).toBeNull();
    expect(mapped.status).toBe(status);
  });

  // Somebody must be able to see what they wrote, or they cannot tell what was
  // taken down.
  it('still shows an author their own silenced comment', () => {
    const mapped = mapper.toComment(
      buildComment({ status: StorytimeCommentStatus.REMOVED_BY_ADMIN }),
      authorId,
    );

    expect(mapped.body).toBe('A fine chapter.');
  });

  it('withholds the words from a signed-out reader', () => {
    const mapped = mapper.toComment(
      buildComment({ status: StorytimeCommentStatus.HIDDEN_BY_OWNER }),
    );

    expect(mapped.body).toBeNull();
  });

  // The moderator and their note are the queue's business, not the thread's.
  it.each(['moderatedByUserId', 'moderationMessage', 'targetId'])(
    'leaves %s out',
    field => {
      expect(
        mapper.toComment(buildComment()) as unknown as Record<string, unknown>,
      ).not.toHaveProperty(field);
    },
  );

  it('keeps a reply pointed at its parent', () => {
    const mapped = mapper.toComment(
      buildComment({ id: 'comment-2', parentCommentId: 'comment-1' }),
    );

    expect(mapped.parentCommentId).toBe('comment-1');
  });

  it('maps a conversation', () => {
    expect(mapper.toList([buildComment()], authorId)).toHaveLength(1);
  });
});
