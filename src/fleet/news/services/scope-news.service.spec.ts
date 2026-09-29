import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { jest } from '@jest/globals';
import { ILike, In, IsNull, Not, QueryFailedError } from 'typeorm';

import { FileAssetAudience } from 'src/file-assets/enums/file-asset-audience.enum';
import { FileAssetKind } from 'src/file-assets/enums/file-asset-kind.enum';
import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AssetWithdrawalService } from 'src/file-assets/services/asset-withdrawal.service';
import { ImageIngressService } from 'src/file-assets/services/image-ingress.service';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';
import { NewsStatus } from 'src/news/enums/news-status.enum';
import { RegistryService } from 'src/registry/registry.service';
import { UserProfileEntity } from 'src/user/entities/user-profile.entity';

import { InMemoryManager } from '../../../../test/in-memory-manager';
import { ActivityEventEntity } from '../../activity/entities/activity-event.entity';
import { ActivityType } from '../../activity/enums/activity.enums';
import { FleetAudienceService } from '../../authorisation/fleet-audience.service';
import { FleetAuthorisationService } from '../../authorisation/fleet-authorisation.service';
import { FLEET_CAPABILITIES } from '../../authorisation/fleet-capability.constants';
import { FleetAudience } from '../../enums/fleet-audience.enum';
import { FleetScopeKind } from '../../enums/fleet-scope-kind.enum';
import { FleetScopeStatus } from '../../enums/fleet-scope-status.enum';
import {
  armadaScope,
  communityScope,
  fleetScope,
} from '../../governance/utilities/governance-scope.utility';
import { SCOPE_NEWS_COVER_SPEC } from '../constants/scope-news.constants';
import { ScopeNewsService } from './scope-news.service';

const COMMUNITY_ID = '27000000-0000-4000-8000-000000000001';
const FLEET_ID = '27000000-0000-4000-8000-000000000002';
const ARMADA_ID = '27000000-0000-4000-8000-000000000003';
const WRITER_ID = '27000000-0000-4000-8000-000000000004';
const READER_ID = '27000000-0000-4000-8000-000000000005';
const POST_ID = '27000000-0000-4000-8000-000000000006';

const FLEET = fleetScope(COMMUNITY_ID, FLEET_ID);
const FLEET_REF = {
  kind: FleetScopeKind.FLEET,
  id: FLEET_ID,
  withinCommunityId: COMMUNITY_ID,
};
const IN_FLEET = {
  communityId: COMMUNITY_ID,
  fleetId: FLEET_ID,
  armadaId: IsNull(),
};
const CREATED = new Date('2026-09-28T09:00:00Z');
const DAY = 86_400_000;
const PUBLISHED = new Date('2026-09-28T10:00:00Z');

/**
 * Builds a post of the Fleet.
 *
 * @param overrides - What differs.
 * @returns The post.
 */
function post(overrides: Partial<NewsPostEntity> = {}): NewsPostEntity {
  return {
    id: POST_ID,
    slug: 'refit-night-abc',
    title: 'Refit night',
    summary: 'Bring your ships',
    body: 'Friday at eight.',
    category: null,
    status: NewsStatus.PUBLISHED,
    publishedAt: PUBLISHED,
    authorId: WRITER_ID,
    communityId: COMMUNITY_ID,
    fleetId: FLEET_ID,
    armadaId: null,
    audience: FleetAudience.PUBLIC,
    coverImageId: null,
    coverImageAlt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  };
}

describe('ScopeNewsService', () => {
  let posts: {
    findAndCount: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
    findOne: jest.Mock<(...args: unknown[]) => Promise<NewsPostEntity | null>>;
    create: jest.Mock<(value: Partial<NewsPostEntity>) => NewsPostEntity>;
    save: jest.Mock<(value: NewsPostEntity) => Promise<NewsPostEntity>>;
    softRemove: jest.Mock<(value: NewsPostEntity) => Promise<NewsPostEntity>>;
    manager: {
      find: jest.Mock<(...args: unknown[]) => Promise<UserProfileEntity[]>>;
      transaction: jest.Mock<
        (
          work: (manager: InMemoryManager) => Promise<unknown>,
        ) => Promise<unknown>
      >;
    };
  };
  let db: InMemoryManager;
  let authorisation: {
    authorise: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let audience: {
    canViewScope: jest.Mock<(...args: unknown[]) => Promise<boolean>>;
    canView: jest.Mock<(...args: unknown[]) => Promise<boolean>>;
  };
  let registry: {
    findVisibleProfileUserIds: jest.Mock<
      (...args: unknown[]) => Promise<Set<string>>
    >;
  };
  let ingress: { accept: jest.Mock<(...args: unknown[]) => Promise<unknown>> };
  let withdrawal: {
    withdrawSlot: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  };
  let service: ScopeNewsService;

  /**
   * Answers the policy for everybody at every scope.
   *
   * @param capabilities - What the caller holds.
   * @param status - The scope's effective status.
   */
  function holding(
    capabilities: string[],
    status = FleetScopeStatus.ACTIVE,
  ): void {
    authorisation.authorise.mockResolvedValue({
      scope: { effectiveStatus: status },
      capabilities: new Set(capabilities),
    });
  }

  beforeEach(() => {
    posts = {
      findAndCount: jest.fn(async () => [[], 0]),
      findOne: jest.fn(async () => null),
      create: jest.fn(value => value as NewsPostEntity),
      save: jest.fn(async value => ({
        ...value,
        id: value.id ?? POST_ID,
        createdAt: value.createdAt ?? CREATED,
        updatedAt: CREATED,
      })),
      softRemove: jest.fn(async value => value),
      manager: {
        find: jest.fn(async () => [
          { userId: WRITER_ID, username: 'Writer' } as UserProfileEntity,
        ]),
        transaction: jest.fn(async work => work(db)),
      },
    };
    db = new InMemoryManager();
    authorisation = { authorise: jest.fn() };
    audience = {
      canViewScope: jest.fn(async () => true),
      canView: jest.fn(async () => true),
    };
    registry = {
      findVisibleProfileUserIds: jest.fn(async () => new Set([WRITER_ID])),
    };
    ingress = { accept: jest.fn(async () => ({ assetId: 'asset-1' })) };
    withdrawal = { withdrawSlot: jest.fn(async () => undefined) };
    holding([]);

    service = new ScopeNewsService(
      posts as never,
      authorisation as unknown as FleetAuthorisationService,
      audience as unknown as FleetAudienceService,
      registry as unknown as RegistryService,
      ingress as unknown as ImageIngressService,
      withdrawal as unknown as AssetWithdrawalService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list', () => {
    it('refuses a reader who may not see the scope, as absent', async () => {
      audience.canViewScope.mockResolvedValue(false);

      await expect(service.list(FLEET, READER_ID, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(audience.canViewScope).toHaveBeenCalledWith(FLEET_REF, READER_ID);
      expect(posts.findAndCount).not.toHaveBeenCalled();
    });

    it('shows a reader only the audiences they are in, newest first', async () => {
      audience.canView.mockImplementation(
        async audienceAsked => audienceAsked !== FleetAudience.FLEET_MEMBERS,
      );
      posts.findAndCount.mockResolvedValue([[post()], 1]);

      const page = await service.list(FLEET, READER_ID, {});

      expect(posts.findAndCount).toHaveBeenCalledWith({
        where: {
          ...IN_FLEET,
          status: NewsStatus.PUBLISHED,
          audience: In([FleetAudience.PUBLIC, FleetAudience.COMMUNITY]),
        },
        order: { publishedAt: 'DESC', createdAt: 'DESC' },
        skip: 0,
        take: 10,
      });
      expect(page).toEqual({
        items: [
          {
            id: POST_ID,
            slug: 'refit-night-abc',
            title: 'Refit night',
            summary: 'Bring your ships',
            status: NewsStatus.PUBLISHED,
            audience: FleetAudience.PUBLIC,
            publishedAt: PUBLISHED,
            createdAt: CREATED,
            updatedAt: CREATED,
            coverImageId: null,
            coverImageAlt: null,
            coverImageUrl: null,
            author: { username: 'Writer', linksToProfile: true },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        mayWrite: false,
        isOpen: true,
      });
      expect(page.items[0]).not.toHaveProperty('body');
    });

    it('shows a news writer every audience, and their drafts by last change', async () => {
      holding([FLEET_CAPABILITIES.NEWS_WRITE]);

      const page = await service.list(FLEET, WRITER_ID, {
        status: NewsStatus.DRAFT,
        page: 3,
        pageSize: 5,
      });

      expect(posts.findAndCount).toHaveBeenCalledWith({
        where: { ...IN_FLEET, status: NewsStatus.DRAFT },
        order: { updatedAt: 'DESC' },
        skip: 10,
        take: 5,
      });
      expect(audience.canView).not.toHaveBeenCalled();
      expect(page.mayWrite).toBe(true);
    });

    it('refuses drafts to a reader without news.write', async () => {
      await expect(
        service.list(FLEET, READER_ID, { status: NewsStatus.DRAFT }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('finds words in the title or the summary, taking them literally', async () => {
      holding([FLEET_CAPABILITIES.NEWS_WRITE]);

      await service.list(FLEET, WRITER_ID, { q: '50%_off' });

      const pattern = ILike('%50\\%\\_off%');

      expect(posts.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { ...IN_FLEET, status: NewsStatus.PUBLISHED, title: pattern },
            { ...IN_FLEET, status: NewsStatus.PUBLISHED, summary: pattern },
          ],
        }),
      );
    });

    it('reads a Community’s own posts, not its Fleets’ or Armadas’', async () => {
      await service.list(communityScope(COMMUNITY_ID), null, {});

      expect(posts.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            communityId: COMMUNITY_ID,
            fleetId: IsNull(),
            armadaId: IsNull(),
          }),
        }),
      );
    });

    it('reads an Armada’s posts', async () => {
      await service.list(armadaScope(COMMUNITY_ID, ARMADA_ID), null, {});

      expect(posts.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fleetId: IsNull(),
            armadaId: ARMADA_ID,
          }),
        }),
      );
    });

    it('says when the scope is no longer open', async () => {
      holding([], FleetScopeStatus.CLOSED);

      const page = await service.list(FLEET, READER_ID, {});

      expect(page.isOpen).toBe(false);
    });

    it('names an author without linking a profile the reader may not open', async () => {
      registry.findVisibleProfileUserIds.mockResolvedValue(new Set());
      posts.findAndCount.mockResolvedValue([
        [post(), post({ id: 'post-2', authorId: null })],
        2,
      ]);

      const page = await service.list(FLEET, null, {});

      expect(page.items.map(item => item.author)).toEqual([
        { username: 'Writer', linksToProfile: false },
        null,
      ]);
      expect(registry.findVisibleProfileUserIds).toHaveBeenCalledWith(
        [WRITER_ID],
        null,
      );
    });
  });

  describe('read', () => {
    it('refuses a reader who may not see the scope', async () => {
      audience.canViewScope.mockResolvedValue(false);

      await expect(service.read(FLEET, 'slug', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers a missing post as absent', async () => {
      await expect(service.read(FLEET, 'slug', null)).rejects.toThrow(
        NotFoundException,
      );
      expect(posts.findOne).toHaveBeenCalledWith({
        where: { ...IN_FLEET, slug: 'slug' },
      });
    });

    it('shows a published post to its audience, in full', async () => {
      posts.findOne.mockResolvedValue(post());

      const view = await service.read(FLEET, 'refit-night-abc', READER_ID);

      expect(audience.canView).toHaveBeenCalledWith(
        FleetAudience.PUBLIC,
        FLEET_REF,
        READER_ID,
      );
      expect(view.post.body).toBe('Friday at eight.');
      expect(view).toEqual(
        expect.objectContaining({ mayWrite: false, isOpen: true }),
      );
    });

    it('answers a post outside the reader’s audience as absent', async () => {
      posts.findOne.mockResolvedValue(
        post({ audience: FleetAudience.FLEET_MEMBERS }),
      );
      audience.canView.mockResolvedValue(false);

      await expect(service.read(FLEET, 'slug', READER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers a draft as absent to a reader without news.write', async () => {
      posts.findOne.mockResolvedValue(post({ status: NewsStatus.DRAFT }));

      await expect(service.read(FLEET, 'slug', READER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(audience.canView).not.toHaveBeenCalled();
    });

    it('shows a draft to a news writer', async () => {
      holding([FLEET_CAPABILITIES.NEWS_WRITE]);
      posts.findOne.mockResolvedValue(post({ status: NewsStatus.DRAFT }));

      const view = await service.read(FLEET, 'slug', WRITER_ID);

      expect(view.post.status).toBe(NewsStatus.DRAFT);
      expect(view.mayWrite).toBe(true);
    });
  });

  describe('create', () => {
    it('writes a public draft with no category, addressed by its title', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

      const written = await service.create(
        FLEET,
        { title: 'Refit night!', summary: '', body: 'Friday.' },
        WRITER_ID,
      );

      expect(posts.create).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        fleetId: FLEET_ID,
        armadaId: null,
        title: 'Refit night!',
        slug: `refit-night-${(1_700_000_000_000).toString(36)}`,
        summary: null,
        body: 'Friday.',
        category: null,
        audience: FleetAudience.PUBLIC,
        status: NewsStatus.DRAFT,
        publishedAt: null,
        authorId: WRITER_ID,
      });
      expect(written).toEqual(
        expect.objectContaining({
          id: POST_ID,
          body: 'Friday.',
          author: { username: 'Writer', linksToProfile: true },
        }),
      );
      expect(registry.findVisibleProfileUserIds).toHaveBeenCalledWith(
        [WRITER_ID],
        WRITER_ID,
      );
    });

    it('keeps the audience and summary chosen', async () => {
      await service.create(
        FLEET,
        {
          title: 'Members',
          summary: 'Just us',
          body: 'Hello.',
          audience: FleetAudience.FLEET_MEMBERS,
        },
        WRITER_ID,
      );

      expect(posts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: 'Just us',
          audience: FleetAudience.FLEET_MEMBERS,
        }),
      );
    });

    it('addresses a title with nothing to slug by its time alone', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(36);

      await service.create(FLEET, { title: '!!!', body: 'x' }, WRITER_ID);

      expect(posts.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: '10' }),
      );
    });

    it('refuses a closed scope', async () => {
      holding([FLEET_CAPABILITIES.NEWS_WRITE], FleetScopeStatus.CLOSED);

      await expect(
        service.create(FLEET, { title: 'T', body: 'B' }, WRITER_ID),
      ).rejects.toThrow(
        new ConflictException(
          'This Fleet is closed, so its news cannot change.',
        ),
      );
      expect(posts.save).not.toHaveBeenCalled();
    });

    it('refuses a suspended Armada', async () => {
      holding([], FleetScopeStatus.SUSPENDED);

      await expect(
        service.create(
          armadaScope(COMMUNITY_ID, ARMADA_ID),
          { title: 'T', body: 'B' },
          WRITER_ID,
        ),
      ).rejects.toThrow('This Armada is suspended, so its news cannot change.');
    });

    it('names a closed Community', async () => {
      holding([], FleetScopeStatus.CLOSED);

      await expect(
        service.create(
          communityScope(COMMUNITY_ID),
          { title: 'T', body: 'B' },
          WRITER_ID,
        ),
      ).rejects.toThrow('This Community is closed');
    });

    it('refuses a scope that does not resolve', async () => {
      authorisation.authorise.mockResolvedValue(null);

      await expect(
        service.create(FLEET, { title: 'T', body: 'B' }, WRITER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('reports a slug taken at the same moment', async () => {
      posts.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], new Error('duplicate key value')),
      );

      await expect(
        service.create(FLEET, { title: 'T', body: 'B' }, WRITER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('lets any other failure through', async () => {
      const failure = new Error('connection lost');

      posts.save.mockRejectedValue(failure);

      await expect(
        service.create(FLEET, { title: 'T', body: 'B' }, WRITER_ID),
      ).rejects.toBe(failure);
    });
  });

  describe('update', () => {
    it('answers a post of another scope as absent', async () => {
      await expect(
        service.update(FLEET, POST_ID, { title: 'New' }, WRITER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(posts.findOne).toHaveBeenCalledWith({
        where: { ...IN_FLEET, id: POST_ID },
      });
    });

    it('changes only what it is sent, and keeps the slug', async () => {
      posts.findOne.mockResolvedValue(post());

      const updated = await service.update(
        FLEET,
        POST_ID,
        {
          title: 'Refit night, moved',
          summary: null,
          body: 'Saturday.',
          audience: FleetAudience.COMMUNITY,
        },
        WRITER_ID,
      );

      expect(updated).toEqual(
        expect.objectContaining({
          slug: 'refit-night-abc',
          title: 'Refit night, moved',
          summary: null,
          body: 'Saturday.',
          audience: FleetAudience.COMMUNITY,
        }),
      );
    });

    it('leaves alone what it is not sent', async () => {
      posts.findOne.mockResolvedValue(post());

      const updated = await service.update(FLEET, POST_ID, {}, WRITER_ID);

      expect(updated).toEqual(
        expect.objectContaining({
          title: 'Refit night',
          summary: 'Bring your ships',
          body: 'Friday at eight.',
          audience: FleetAudience.PUBLIC,
        }),
      );
    });

    it('refuses a closed scope', async () => {
      posts.findOne.mockResolvedValue(post());
      holding([], FleetScopeStatus.CLOSED);

      await expect(
        service.update(FLEET, POST_ID, { title: 'X' }, WRITER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('publish', () => {
    it('dates a draft now', async () => {
      const now = new Date('2026-09-28T12:00:00Z');

      jest.useFakeTimers({ now });
      posts.findOne.mockResolvedValue(
        post({ status: NewsStatus.DRAFT, publishedAt: null }),
      );

      const published = await service.publish(FLEET, POST_ID, WRITER_ID);

      jest.useRealTimers();
      expect(published).toEqual(
        expect.objectContaining({
          status: NewsStatus.PUBLISHED,
          publishedAt: now,
        }),
      );
      expect(posts.save).not.toHaveBeenCalled();
      expect(db.rows(NewsPostEntity)).toHaveLength(1);
      expect(db.rows(ActivityEventEntity)).toEqual([
        expect.objectContaining({
          type: ActivityType.NEWS_PUBLISHED,
          actorUserId: WRITER_ID,
          sourceId: POST_ID,
          idempotencyKey: `NEWS_PUBLISHED:${POST_ID}:2026-09-28T12:00:00.000Z`,
          occurredAt: now,
        }),
      ]);
    });

    it('keeps the date of a post already published, and adds no item', async () => {
      posts.findOne.mockResolvedValue(post());

      const published = await service.publish(FLEET, POST_ID, WRITER_ID);

      expect(published.publishedAt).toBe(PUBLISHED);
      expect(posts.manager.transaction).not.toHaveBeenCalled();
    });

    it('keeps a draft’s date where it has one', async () => {
      posts.findOne.mockResolvedValue(
        post({ status: NewsStatus.DRAFT, publishedAt: PUBLISHED }),
      );

      const published = await service.publish(FLEET, POST_ID, WRITER_ID);

      expect(published.publishedAt).toBe(PUBLISHED);
    });

    it('answers a missing post as absent', async () => {
      await expect(service.publish(FLEET, POST_ID, WRITER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unpublish', () => {
    it('takes a post back to an undated draft', async () => {
      posts.findOne.mockResolvedValue(post());

      const draft = await service.unpublish(FLEET, POST_ID, WRITER_ID);

      expect(draft).toEqual(
        expect.objectContaining({
          status: NewsStatus.DRAFT,
          publishedAt: null,
        }),
      );
    });

    it('refuses a closed scope', async () => {
      posts.findOne.mockResolvedValue(post());
      holding([], FleetScopeStatus.CLOSED);

      await expect(
        service.unpublish(FLEET, POST_ID, WRITER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes a published post and takes its cover down', async () => {
      const covered = post({ coverImageId: 'img-1', coverImageAlt: 'A ship' });

      posts.findOne.mockResolvedValue(covered);

      await service.remove(FLEET, POST_ID, WRITER_ID);

      expect(posts.softRemove).toHaveBeenCalledWith(covered);
      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.NEWS_POST,
        POST_ID,
        FileAssetSlot.COVER,
        'img-1',
        'Its post was deleted',
      );
    });

    it('withdraws nothing from a post with no cover', async () => {
      posts.findOne.mockResolvedValue(post());

      await service.remove(FLEET, POST_ID, WRITER_ID);

      expect(withdrawal.withdrawSlot).not.toHaveBeenCalled();
    });

    it('keeps a closed scope’s published post', async () => {
      posts.findOne.mockResolvedValue(post());
      holding([], FleetScopeStatus.CLOSED);

      await expect(service.remove(FLEET, POST_ID, WRITER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(posts.softRemove).not.toHaveBeenCalled();
    });

    it('lets a closed scope’s draft go', async () => {
      posts.findOne.mockResolvedValue(
        post({ status: NewsStatus.DRAFT, publishedAt: null }),
      );
      holding([], FleetScopeStatus.CLOSED);

      await service.remove(FLEET, POST_ID, WRITER_ID);

      expect(posts.softRemove).toHaveBeenCalled();
      expect(authorisation.authorise).not.toHaveBeenCalled();
    });
  });

  describe('setCover', () => {
    it('sends the picture to be scanned for the post, at its audience', async () => {
      const file = { originalname: 'cover.jpg' } as Express.Multer.File;

      posts.findOne.mockResolvedValue(
        post({ audience: FleetAudience.COMMUNITY }),
      );

      await expect(
        service.setCover(FLEET, POST_ID, {
          userId: WRITER_ID,
          altText: 'A ship',
          file,
        }),
      ).resolves.toEqual({ assetId: 'asset-1' });

      expect(ingress.accept).toHaveBeenCalledWith({
        spec: SCOPE_NEWS_COVER_SPEC,
        userId: WRITER_ID,
        kind: FileAssetKind.FLEET_IMAGE,
        audience: FileAssetAudience.SCOPE,
        subject: FileAssetSubject.NEWS_POST,
        subjectId: POST_ID,
        slot: FileAssetSlot.COVER,
        scope: {
          communityId: COMMUNITY_ID,
          fleetId: FLEET_ID,
          armadaId: null,
          audience: FleetAudience.COMMUNITY,
        },
        entityTag: 'fleet-news-cover',
        entityId: POST_ID,
        maximumBytes: expect.any(Number),
        sizeLimitLabel: 'News covers',
        file,
        feature: { altText: 'A ship' },
      });
    });

    it('refuses a closed scope', async () => {
      posts.findOne.mockResolvedValue(post());
      holding([], FleetScopeStatus.CLOSED);

      await expect(
        service.setCover(FLEET, POST_ID, {
          userId: WRITER_ID,
          altText: 'A ship',
          file: {} as Express.Multer.File,
        }),
      ).rejects.toThrow(ConflictException);
      expect(ingress.accept).not.toHaveBeenCalled();
    });
  });

  describe('clearCover', () => {
    it('empties the post before withdrawing its picture', async () => {
      posts.findOne.mockResolvedValue(
        post({ coverImageId: 'img-1', coverImageAlt: 'A ship' }),
      );

      await service.clearCover(FLEET, POST_ID, WRITER_ID);

      expect(posts.save).toHaveBeenCalledWith(
        expect.objectContaining({ coverImageId: null, coverImageAlt: null }),
      );
      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.NEWS_POST,
        POST_ID,
        FileAssetSlot.COVER,
        'img-1',
        'Removed from its post',
      );
      expect(posts.save.mock.invocationCallOrder[0]).toBeLessThan(
        withdrawal.withdrawSlot.mock.invocationCallOrder[0],
      );
    });

    it('says when there is no cover to remove', async () => {
      posts.findOne.mockResolvedValue(post());

      await expect(
        service.clearCover(FLEET, POST_ID, WRITER_ID),
      ).rejects.toThrow('There is no cover there to remove.');
    });
  });

  describe('forgetting deleted posts (FC-037)', () => {
    it('deletes scoped posts deleted more than 30 days ago, never the site’s', async () => {
      db.seed(NewsPostEntity, [
        {
          id: 'old',
          communityId: COMMUNITY_ID,
          deletedAt: new Date(Date.now() - 31 * DAY),
        },
        {
          id: 'recent',
          communityId: COMMUNITY_ID,
          deletedAt: new Date(Date.now() - 29 * DAY),
        },
        { id: 'live', communityId: COMMUNITY_ID, deletedAt: null },
        {
          id: 'site',
          communityId: null,
          deletedAt: new Date(Date.now() - 90 * DAY),
        },
      ]);

      const purging = new ScopeNewsService(
        { manager: db.asManager() } as never,
        authorisation as unknown as FleetAuthorisationService,
        audience as unknown as FleetAudienceService,
        registry as unknown as RegistryService,
        ingress as unknown as ImageIngressService,
        withdrawal as unknown as AssetWithdrawalService,
      );

      await expect(purging.purgeDeleted()).resolves.toEqual({
        counts: { posts: 1 },
        complete: true,
      });
      expect(db.rows(NewsPostEntity).map(row => row.id)).toEqual([
        'recent',
        'live',
        'site',
      ]);
    });
  });

  describe('as a site administrator', () => {
    it('unpublishes any scoped post, never one of the site’s own', async () => {
      const found = post();

      posts.findOne.mockResolvedValue(found);

      await service.unpublishAsSiteAdmin(POST_ID);

      expect(posts.findOne).toHaveBeenCalledWith({
        where: { id: POST_ID, communityId: Not(IsNull()) },
      });
      expect(posts.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: NewsStatus.DRAFT,
          publishedAt: null,
        }),
      );
      expect(authorisation.authorise).not.toHaveBeenCalled();
    });

    it('deletes any scoped post, and says why its cover went', async () => {
      posts.findOne.mockResolvedValue(post({ coverImageId: 'img-1' }));

      await service.removeAsSiteAdmin(POST_ID);

      expect(posts.softRemove).toHaveBeenCalled();
      expect(withdrawal.withdrawSlot).toHaveBeenCalledWith(
        FileAssetSubject.NEWS_POST,
        POST_ID,
        FileAssetSlot.COVER,
        'img-1',
        'Its post was deleted by a site administrator',
      );
    });

    it('answers a post that is not scoped as absent', async () => {
      await expect(service.removeAsSiteAdmin(POST_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.unpublishAsSiteAdmin(POST_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
