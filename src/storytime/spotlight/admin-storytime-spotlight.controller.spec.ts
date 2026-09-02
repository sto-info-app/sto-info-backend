import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import { StorytimeArcMapper } from '../arcs/storytime-arc.mapper';
import { SpotlightEntityType } from '../enums/spotlight-entity-type.enum';
import { StorytimeStoryEntity } from '../stories/entities/storytime-story.entity';
import { StorytimeStoryMapper } from '../stories/storytime-story.mapper';
import { StorytimeTagMapper } from '../tags/storytime-tag.mapper';
import { AdminStorytimeSpotlightController } from './admin-storytime-spotlight.controller';
import { StorytimeSpotlightEntity } from './entities/storytime-spotlight.entity';
import { StorytimeSpotlightMapper } from './storytime-spotlight.mapper';
import { StorytimeSpotlightService } from './storytime-spotlight.service';

describe('AdminStorytimeSpotlightController', () => {
  let controller: AdminStorytimeSpotlightController;
  let spotlightService: {
    findAll: jest.Mock;
    findOneWithWorkOrFail: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    publish: jest.Mock;
    unpublish: jest.Mock;
    remove: jest.Mock;
    setOverrideImage: jest.Mock;
    clearOverrideImage: jest.Mock;
  };

  const editorId = 'editor-1';
  const spotlightId = 'spotlight-1';

  const entry = Object.assign(new StorytimeSpotlightEntity(), {
    id: spotlightId,
    slug: 'a-fine-story',
    entityType: SpotlightEntityType.STORY,
    storyId: 'story-1',
    arcId: null,
    headline: 'A Fine Story',
    summary: 'Worth your evening.',
    selectionReason: null,
    overrideImageId: null,
    overrideImageAlt: null,
    displayPriority: 0,
    startsAt: new Date('2026-06-01T00:00:00.000Z'),
    endsAt: null,
    isPublished: false,
    createdByUserId: editorId,
    updatedByUserId: editorId,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  });

  const story = Object.assign(new StorytimeStoryEntity(), {
    id: 'story-1',
    title: 'A Fine Story',
    slug: 'a-fine-story',
  });

  /** The entry as the service hands it over: with whatever it features. */
  const resolved = { entry, story, arc: null, author: null, tags: [] };

  /** The smallest valid creation request. */
  const request = {
    entityType: SpotlightEntityType.STORY,
    storyId: 'story-1',
    headline: 'A Fine Story',
    summary: 'Worth your evening.',
    startsAt: '2026-06-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    spotlightService = {
      findAll: jest.fn().mockResolvedValue([resolved]),
      findOneWithWorkOrFail: jest.fn().mockResolvedValue(resolved),
      create: jest.fn().mockResolvedValue(entry),
      update: jest.fn().mockResolvedValue(entry),
      publish: jest.fn().mockResolvedValue(entry),
      unpublish: jest.fn().mockResolvedValue(entry),
      remove: jest.fn().mockResolvedValue(undefined),
      setOverrideImage: jest.fn().mockResolvedValue(entry),
      clearOverrideImage: jest.fn().mockResolvedValue(entry),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminStorytimeSpotlightController],
      providers: [
        { provide: StorytimeSpotlightService, useValue: spotlightService },
        StorytimeSpotlightMapper,
        StorytimeStoryMapper,
        StorytimeArcMapper,
        StorytimeTagMapper,
        // The permissions guard declared on the controller needs this to be
        // constructible. Its behaviour is covered by its own spec; here the
        // controller's own logic is what is under test.
        {
          provide: AccessControlService,
          useValue: { getPermissionCodes: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<AdminStorytimeSpotlightController>(
      AdminStorytimeSpotlightController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('lists every entry', async () => {
    const entries = await controller.findAll();

    expect(entries).toHaveLength(1);
    expect(entries[0].isPublished).toBe(false);
  });

  // An editor manages entries by name, so the name of the featured work comes
  // back with each one.
  it('names the work each entry features', async () => {
    const entries = await controller.findAll();

    expect(entries[0].story?.title).toBe('A Fine Story');
  });

  it('reads one entry', async () => {
    const found = await controller.findOne(spotlightId);

    expect(found.id).toBe(spotlightId);
    expect(found.story?.title).toBe('A Fine Story');
  });

  it('reports an entry that is not there', async () => {
    spotlightService.findOneWithWorkOrFail.mockRejectedValue(
      new NotFoundException(),
    );

    await expect(controller.findOne(spotlightId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('drafts an entry', async () => {
    await controller.create(request, editorId);

    expect(spotlightService.create).toHaveBeenCalledWith(request, editorId);
  });

  it('changes an entry', async () => {
    await controller.update(spotlightId, { headline: 'Read This' }, editorId);

    expect(spotlightService.update).toHaveBeenCalledWith(
      spotlightId,
      { headline: 'Read This' },
      editorId,
    );
  });

  it.each([
    ['publish', 'publish'],
    ['unpublish', 'unpublish'],
  ])('%ses an entry', async (_name, method) => {
    const act = controller[method as 'publish' | 'unpublish'].bind(controller);

    await act(spotlightId, editorId);

    expect(
      spotlightService[method as 'publish' | 'unpublish'],
    ).toHaveBeenCalledWith(spotlightId, editorId);
  });

  it('deletes an entry', async () => {
    await controller.remove(spotlightId, editorId);

    expect(spotlightService.remove).toHaveBeenCalledWith(spotlightId, editorId);
  });

  describe('the editorial artwork', () => {
    const file = { originalname: 'spotlight.jpg' } as Express.Multer.File;

    it('passes the upload and its description on', async () => {
      await controller.setOverrideImage(spotlightId, editorId, file, {
        altText: 'A fleet at anchor',
      });

      expect(spotlightService.setOverrideImage).toHaveBeenCalledWith(
        spotlightId,
        editorId,
        file,
        'A fleet at anchor',
      );
    });

    it('asks for the artwork to be removed', async () => {
      await controller.clearOverrideImage(spotlightId, editorId);

      expect(spotlightService.clearOverrideImage).toHaveBeenCalledWith(
        spotlightId,
        editorId,
      );
    });

    it('complains when no file arrived', async () => {
      await expect(
        controller.setOverrideImage(spotlightId, editorId, undefined, {
          altText: 'A fleet',
        }),
      ).rejects.toThrow('An image file is required');

      expect(spotlightService.setOverrideImage).not.toHaveBeenCalled();
    });
  });

  // An editor has to be able to prepare selections in an environment where the
  // Spotlight is not being shown yet, so no feature flag is consulted here.
  it('answers whether or not the Spotlight is switched on', async () => {
    await expect(controller.findAll()).resolves.toBeDefined();
  });
});
