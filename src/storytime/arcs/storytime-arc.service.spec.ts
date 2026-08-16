import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeMarkdownService } from '../content/storytime-markdown.service';
import { ArcStatus } from '../enums/arc-status.enum';
import { StorytimeModerationStatus } from '../enums/storytime-moderation-status.enum';
import { StorytimeTargetType } from '../enums/storytime-target-type.enum';
import { StorytimeVisibility } from '../enums/storytime-visibility.enum';
import { StorytimeOrderingService } from '../shared/storytime-ordering.service';
import {
  SlugRequest,
  StorytimeSlugService,
} from '../shared/storytime-slug.service';
import { StorytimeArcEntity } from './entities/storytime-arc.entity';
import { StorytimeArcService } from './storytime-arc.service';

describe('StorytimeArcService', () => {
  let service: StorytimeArcService;
  let arcRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    softDelete: jest.Mock;
  };
  let slugService: {
    generateUniqueSlug: jest.Mock;
    recordRetiredSlug: jest.Mock;
  };

  const curatorId = 'e6d3a1b2-0000-4000-8000-000000000001';
  const strangerId = 'e6d3a1b2-0000-4000-8000-000000000002';
  const arcId = 'e6d3a1b2-0000-4000-8000-0000000000aa';

  /**
   * Builds an Arc.
   *
   * @param overrides - Fields to change.
   * @returns The Arc entity.
   */
  const buildArc = (
    overrides: Partial<StorytimeArcEntity> = {},
  ): StorytimeArcEntity =>
    Object.assign(new StorytimeArcEntity(), {
      id: arcId,
      ownerUserId: curatorId,
      title: 'The Long War',
      slug: 'the-long-war',
      shortDescription: null,
      description: null,
      descriptionHtml: null,
      status: ArcStatus.DRAFT,
      visibility: StorytimeVisibility.PRIVATE,
      languageCode: 'en',
      moderationStatus: StorytimeModerationStatus.ACTIVE,
      upVoteCount: 0,
      downVoteCount: 0,
      version: 1,
      publishedAt: null,
      ...overrides,
    });

  beforeEach(async () => {
    arcRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input => Object.assign(new StorytimeArcEntity(), input)),
      save: jest.fn(input => Promise.resolve(input)),
      count: jest.fn().mockResolvedValue(0),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    slugService = {
      generateUniqueSlug: jest.fn(async (request: SlugRequest) => {
        await request.isTakenByLiveEntity('candidate-slug');
        return 'the-long-war';
      }),
      recordRetiredSlug: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeArcService,
        {
          provide: getRepositoryToken(StorytimeArcEntity),
          useValue: arcRepository,
        },
        { provide: StorytimeSlugService, useValue: slugService },
        StorytimeOrderingService,
        StorytimeMarkdownService,
      ],
    }).compile();

    service = module.get<StorytimeArcService>(StorytimeArcService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    // Anybody may curate: an Arc is a reading order, not a claim on anything.
    it('creates an Arc curated by the caller', async () => {
      const created = await service.create(
        { title: 'The Long War' },
        curatorId,
      );

      expect(created.ownerUserId).toBe(curatorId);
      expect(created.createdByUserId).toBe(curatorId);
    });

    it('names the Arc slug scope so it is unique site-wide', async () => {
      await service.create({ title: 'The Long War' }, curatorId);

      expect(slugService.generateUniqueSlug).toHaveBeenCalledWith(
        expect.objectContaining({ targetType: StorytimeTargetType.ARC }),
      );
    });

    it('renders the description', async () => {
      const created = await service.create(
        { title: 'The Long War', description: '# Heading' },
        curatorId,
      );

      expect(created.descriptionHtml).toContain('<h2');
    });

    it('leaves rendered HTML empty when there is no description', async () => {
      const created = await service.create(
        { title: 'The Long War' },
        curatorId,
      );

      expect(created.descriptionHtml).toBeNull();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      arcRepository.findOne.mockResolvedValue(buildArc());
    });

    it('changes the title', async () => {
      const updated = await service.update(
        arcId,
        { title: 'The Longer War' },
        curatorId,
      );

      expect(updated.title).toBe('The Longer War');
      expect(updated.version).toBe(2);
    });

    it('re-renders the description when it changes', async () => {
      const updated = await service.update(
        arcId,
        { description: 'A *new* summary.' },
        curatorId,
      );

      expect(updated.descriptionHtml).toContain('<em>new</em>');
    });

    it('clears the rendered description when it is emptied', async () => {
      const updated = await service.update(
        arcId,
        { description: '' },
        curatorId,
      );

      expect(updated.descriptionHtml).toBeNull();
    });

    it('leaves the description alone when it is not sent', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({ descriptionHtml: '<p id="b1">Existing.</p>' }),
      );

      const updated = await service.update(
        arcId,
        { title: 'Renamed' },
        curatorId,
      );

      expect(updated.descriptionHtml).toBe('<p id="b1">Existing.</p>');
    });

    it('retires the old slug when it changes', async () => {
      await service.update(arcId, { slug: 'the-longer-war' }, curatorId);

      expect(slugService.recordRetiredSlug).toHaveBeenCalledWith(
        StorytimeTargetType.ARC,
        arcId,
        'the-long-war',
        expect.any(String),
      );
    });

    it('refuses a stale edit', async () => {
      await expect(
        service.update(arcId, { title: 'Nope', version: 99 }, curatorId),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses somebody who does not curate it', async () => {
      await expect(
        service.update(arcId, { title: 'Nope' }, strangerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reports an Arc that does not exist', async () => {
      arcRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update(arcId, { title: 'Nope' }, curatorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('publishing', () => {
    beforeEach(() => {
      arcRepository.findOne.mockResolvedValue(buildArc());
    });

    it('publishes an Arc with something agreed in it', async () => {
      const published = await service.publish(arcId, curatorId, 2);

      expect(published.status).toBe(ArcStatus.PUBLISHED);
      expect(published.publishedAt).toBeInstanceOf(Date);
    });

    // Publishing an empty Arc would promise a reading order and then show an
    // empty page.
    it('refuses an Arc nothing has agreed to be in', async () => {
      await expect(service.publish(arcId, curatorId, 0)).rejects.toThrow(
        /at least one Story/,
      );
    });

    it('does nothing when it is already published', async () => {
      const first = new Date('2026-01-01T00:00:00Z');
      arcRepository.findOne.mockResolvedValue(
        buildArc({ status: ArcStatus.PUBLISHED, publishedAt: first }),
      );

      const published = await service.publish(arcId, curatorId, 1);

      expect(published.publishedAt).toBe(first);
      expect(arcRepository.save).not.toHaveBeenCalled();
    });

    it('keeps the original publication date when republishing', async () => {
      const first = new Date('2026-01-01T00:00:00Z');
      arcRepository.findOne.mockResolvedValue(
        buildArc({ status: ArcStatus.UNPUBLISHED, publishedAt: first }),
      );

      const published = await service.publish(arcId, curatorId, 1);

      expect(published.publishedAt).toBe(first);
    });

    it('withdraws an Arc', async () => {
      const unpublished = await service.unpublish(arcId, curatorId);

      expect(unpublished.status).toBe(ArcStatus.UNPUBLISHED);
    });

    it.each([
      ['publish', () => service.publish(arcId, strangerId, 1)],
      ['unpublish', () => service.unpublish(arcId, strangerId)],
    ])('refuses to let a stranger %s it', async (_name, act) => {
      await expect(act()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('public reading', () => {
    it('returns a published public Arc', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({
          status: ArcStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-war'),
      ).resolves.toBeDefined();
    });

    // An unlisted Arc is readable by anyone holding the link.
    it('returns an unlisted Arc', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({
          status: ArcStatus.PUBLISHED,
          visibility: StorytimeVisibility.UNLISTED,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-war'),
      ).resolves.toBeDefined();
    });

    it.each([
      ['a draft', { status: ArcStatus.DRAFT }],
      ['a private Arc', { visibility: StorytimeVisibility.PRIVATE }],
      [
        'a removed Arc',
        { moderationStatus: StorytimeModerationStatus.REMOVED },
      ],
    ])('hides %s', async (_name, overrides) => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({
          status: ArcStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
          ...overrides,
        }),
      );

      await expect(
        service.findPublicBySlug('the-long-war'),
      ).resolves.toBeNull();
    });

    it('reports nothing for an unknown slug', async () => {
      await expect(service.findPublicBySlug('nope')).resolves.toBeNull();
    });

    // Unlisted Arcs are excluded from browsing, exactly as Stories are: that
    // is the whole difference between unlisted and public.
    it('lists only public Arcs for discovery', async () => {
      await service.findPublic();

      expect(arcRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            visibility: StorytimeVisibility.PUBLIC,
          }),
        }),
      );
    });

    it('filters a set of Arcs to the readable ones', async () => {
      arcRepository.find.mockResolvedValue([
        buildArc({
          status: ArcStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
        }),
        buildArc({ id: 'draft' }),
      ]);

      await expect(
        service.findPublicByIds([arcId, 'draft']),
      ).resolves.toHaveLength(1);
    });

    // Asking the database for nothing would return every Arc.
    it('asks for nothing when given no identifiers', async () => {
      await expect(service.findPublicByIds([])).resolves.toEqual([]);
      expect(arcRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('listing and deleting', () => {
    it('lists the Arcs somebody curates', async () => {
      await service.findOwnedByUser(curatorId);

      expect(arcRepository.find).toHaveBeenCalledWith({
        where: { ownerUserId: curatorId },
        order: { updatedAt: 'DESC' },
      });
    });

    // Soft-deleted so its memberships survive as a record of what was agreed.
    it('soft-deletes an Arc and records who did it', async () => {
      arcRepository.findOne.mockResolvedValue(buildArc());

      await service.remove(arcId, curatorId);

      expect(arcRepository.softDelete).toHaveBeenCalledWith(arcId);
      expect(arcRepository.save.mock.calls[0][0].deletedByUserId).toBe(
        curatorId,
      );
    });

    it('refuses to delete an Arc the caller does not curate', async () => {
      arcRepository.findOne.mockResolvedValue(buildArc());

      await expect(service.remove(arcId, strangerId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  it('places a new Story at the start of an empty Arc', () => {
    expect(service.nextOrderIndex(null)).toBe(1000);
  });

  it('places a new Story after the last', () => {
    expect(service.nextOrderIndex(3000)).toBe(4000);
  });

  it('refuses a publish for an Arc that does not exist', async () => {
    arcRepository.findOne.mockResolvedValue(null);

    await expect(service.publish(arcId, curatorId, 1)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses an empty Arc before checking anything else', async () => {
    arcRepository.findOne.mockResolvedValue(buildArc());

    await expect(service.publish(arcId, curatorId, 0)).rejects.toThrow(
      BadRequestException,
    );
  });
});
