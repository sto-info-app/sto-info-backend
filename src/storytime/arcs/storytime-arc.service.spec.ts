import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeArcCollaboratorAccessService } from '../collaboration/storytime-arc-collaborator-access.service';
import { ArcCapability } from '../collaboration/storytime-arc-capability.enum';
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
import { StorytimeImageSlot } from '../enums/storytime-image-slot.enum';
import { StorytimeImageService } from '../images/storytime-image.service';
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
  let collaboratorAccessService: {
    hasCapability: jest.Mock;
    findAccepted: jest.Mock;
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
      bannerImageId: null,
      bannerImageAlt: null,
      profileImageId: null,
      profileImageAlt: null,
      upVoteCount: 0,
      downVoteCount: 0,
      version: 1,
      publishedAt: null,
      ...overrides,
    });

  let imageService: {
    store: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(async () => {
    // The upload pipeline is stubbed: what a real Cloudflare call would do is
    // its own service's business, and these tests are about what the work
    // records afterwards.
    imageService = {
      store: jest.fn().mockResolvedValue('stored-image-id'),
      release: jest.fn().mockResolvedValue(undefined),
    };

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

    // Nobody collaborates unless a test says so, so every existing
    // expectation still describes the curator acting alone.
    collaboratorAccessService = {
      hasCapability: jest.fn().mockResolvedValue(false),
      findAccepted: jest.fn().mockResolvedValue(null),
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
        {
          provide: StorytimeArcCollaboratorAccessService,
          useValue: collaboratorAccessService,
        },
        { provide: StorytimeImageService, useValue: imageService },
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

  describe('artwork', () => {
    const file = { originalname: 'banner.jpg' } as Express.Multer.File;

    it('records the stored image and what it shows', async () => {
      arcRepository.findOne.mockResolvedValue(buildArc());

      const saved = await service.setImage(
        arcId,
        curatorId,
        StorytimeImageSlot.ARC_BANNER,
        file,
        'A fleet at anchor',
      );

      expect(imageService.store).toHaveBeenCalledWith({
        slot: StorytimeImageSlot.ARC_BANNER,
        userId: curatorId,
        entityId: arcId,
        file,
      });
      expect(saved.bannerImageId).toBe('stored-image-id');
      expect(saved.bannerImageAlt).toBe('A fleet at anchor');
      expect(saved.version).toBe(2);
    });

    it('sets the profile image without touching the banner', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({ bannerImageId: 'banner-1', bannerImageAlt: 'A fleet' }),
      );

      const saved = await service.setImage(
        arcId,
        curatorId,
        StorytimeImageSlot.ARC_PROFILE,
        file,
        'An Arc badge',
      );

      expect(saved.profileImageId).toBe('stored-image-id');
      expect(saved.bannerImageId).toBe('banner-1');
    });

    it('releases the image it replaced', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({ bannerImageId: 'old-banner' }),
      );

      await service.setImage(
        arcId,
        curatorId,
        StorytimeImageSlot.ARC_BANNER,
        file,
        'A fleet',
      );

      expect(imageService.release).toHaveBeenCalledWith('old-banner');
    });

    it('refuses somebody with no access to the Arc', async () => {
      arcRepository.findOne.mockResolvedValue(buildArc());

      await expect(
        service.setImage(
          arcId,
          strangerId,
          StorytimeImageSlot.ARC_BANNER,
          file,
          'A fleet',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(imageService.store).not.toHaveBeenCalled();
    });

    it('clears the description along with the image', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({ profileImageId: 'profile-1', profileImageAlt: 'A badge' }),
      );

      const saved = await service.clearImage(
        arcId,
        curatorId,
        StorytimeImageSlot.ARC_PROFILE,
      );

      expect(saved.profileImageId).toBeNull();
      expect(saved.profileImageAlt).toBeNull();
      expect(imageService.release).toHaveBeenCalledWith('profile-1');
    });

    it('refuses a removal from somebody with no access', async () => {
      arcRepository.findOne.mockResolvedValue(buildArc());

      await expect(
        service.clearImage(arcId, strangerId, StorytimeImageSlot.ARC_BANNER),
      ).rejects.toBeInstanceOf(ForbiddenException);
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

    // A reader who followed a link deserves to know the Arc was taken down
    // rather than being told it never existed.
    it('says a removed Arc is gone rather than missing', async () => {
      arcRepository.findOne.mockResolvedValue(
        buildArc({
          status: ArcStatus.PUBLISHED,
          visibility: StorytimeVisibility.PUBLIC,
          moderationStatus: StorytimeModerationStatus.REMOVED,
        }),
      );

      await expect(service.findPublicBySlug('the-long-war')).rejects.toThrow(
        GoneException,
      );
    });

    it.each([
      ['a draft', { status: ArcStatus.DRAFT }],
      ['a private Arc', { visibility: StorytimeVisibility.PRIVATE }],
      [
        'a removed draft, without announcing the removal',
        {
          status: ArcStatus.DRAFT,
          moderationStatus: StorytimeModerationStatus.REMOVED,
        },
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

    // A creator's profile shows what they curate publicly, not their drafts.
    it('lists only the public Arcs one member curates', async () => {
      await service.findPublicByOwner(curatorId);

      expect(arcRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerUserId: curatorId,
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

  describe('collaborator access', () => {
    beforeEach(() => {
      arcRepository.findOne.mockResolvedValue(buildArc());
    });

    describe('findEditableOrFail', () => {
      it('lets the curator do anything without asking about collaborations', async () => {
        await expect(
          service.findEditableOrFail(
            arcId,
            curatorId,
            ArcCapability.MANAGE_STORIES,
          ),
        ).resolves.toBeDefined();

        expect(collaboratorAccessService.hasCapability).not.toHaveBeenCalled();
      });

      it('lets a collaborator granted the capability through', async () => {
        collaboratorAccessService.hasCapability.mockResolvedValue(true);

        await expect(
          service.findEditableOrFail(
            arcId,
            strangerId,
            ArcCapability.MANAGE_STORIES,
          ),
        ).resolves.toBeDefined();
      });

      it('asks about the capability actually being used', async () => {
        collaboratorAccessService.hasCapability.mockResolvedValue(true);

        await service.findEditableOrFail(
          arcId,
          strangerId,
          ArcCapability.EDIT_ARC,
        );

        expect(collaboratorAccessService.hasCapability).toHaveBeenCalledWith(
          arcId,
          strangerId,
          ArcCapability.EDIT_ARC,
        );
      });

      it('refuses somebody who was not granted it', async () => {
        await expect(
          service.findEditableOrFail(arcId, strangerId, ArcCapability.EDIT_ARC),
        ).rejects.toThrow(ForbiddenException);
      });

      it('reports an Arc that does not exist', async () => {
        arcRepository.findOne.mockResolvedValue(null);

        await expect(
          service.findEditableOrFail(arcId, curatorId, ArcCapability.EDIT_ARC),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('findAccessibleOrFail', () => {
      it('lets the curator in', async () => {
        await expect(
          service.findAccessibleOrFail(arcId, curatorId),
        ).resolves.toBeDefined();
      });

      // Somebody invited only to chase up Story owners still has to open the
      // Arc to do it.
      it('lets any accepted collaborator in, whatever they were granted', async () => {
        collaboratorAccessService.findAccepted.mockResolvedValue({
          canEditArc: false,
          canManageStories: false,
        });

        await expect(
          service.findAccessibleOrFail(arcId, strangerId),
        ).resolves.toBeDefined();
      });

      it('refuses somebody with no accepted collaboration', async () => {
        await expect(
          service.findAccessibleOrFail(arcId, strangerId),
        ).rejects.toThrow(ForbiddenException);
      });

      it('reports an Arc that does not exist', async () => {
        arcRepository.findOne.mockResolvedValue(null);

        await expect(
          service.findAccessibleOrFail(arcId, curatorId),
        ).rejects.toThrow(NotFoundException);
      });
    });

    // Publishing is never delegated, so these stay curator-only however
    // generously somebody has been invited.
    describe('what a collaborator can never do', () => {
      beforeEach(() => {
        collaboratorAccessService.hasCapability.mockResolvedValue(true);
        collaboratorAccessService.findAccepted.mockResolvedValue({
          canEditArc: true,
        });
      });

      it.each([
        ['publish', () => service.publish(arcId, strangerId, 1)],
        ['unpublish', () => service.unpublish(arcId, strangerId)],
        ['delete', () => service.remove(arcId, strangerId)],
      ])('refuses to let a collaborator %s an Arc', async (_name, act) => {
        await expect(act()).rejects.toThrow(ForbiddenException);
      });
    });

    it('lets a collaborator granted it edit the Arc', async () => {
      collaboratorAccessService.hasCapability.mockResolvedValue(true);

      await expect(
        service.update(arcId, { title: 'Renamed' }, strangerId),
      ).resolves.toBeDefined();
    });

    it('refuses an edit from a collaborator not granted it', async () => {
      await expect(
        service.update(arcId, { title: 'Renamed' }, strangerId),
      ).rejects.toThrow(ForbiddenException);
    });

    describe('listing what somebody can work on', () => {
      it('includes the Arcs they curate', async () => {
        await service.findWorkableByUser(curatorId, []);

        expect(arcRepository.find).toHaveBeenCalledWith(
          expect.objectContaining({ where: { ownerUserId: curatorId } }),
        );
      });

      it('includes the Arcs they help with', async () => {
        await service.findWorkableByUser(curatorId, [arcId]);

        const where = arcRepository.find.mock.calls[0][0].where;
        expect(Array.isArray(where)).toBe(true);
        expect(where).toHaveLength(2);
      });
    });
  });
});
