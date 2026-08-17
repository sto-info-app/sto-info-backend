import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorytimeTagCategory } from '../enums/storytime-tag-category.enum';
import { StorytimeTagEntity } from './entities/storytime-tag.entity';
import { StorytimeTagService } from './storytime-tag.service';

describe('StorytimeTagService', () => {
  let service: StorytimeTagService;
  let tagRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };

  const adminId = 'admin-1';
  const tagId = 'tag-1';

  /**
   * Builds a tag.
   *
   * @param overrides - Fields to change.
   * @returns The tag.
   */
  const buildTag = (
    overrides: Partial<StorytimeTagEntity> = {},
  ): StorytimeTagEntity =>
    Object.assign(new StorytimeTagEntity(), {
      id: tagId,
      slug: 'klingon',
      name: 'Klingon',
      description: null,
      category: StorytimeTagCategory.FACTION,
      isAdminManaged: true,
      displayOrder: 0,
      createdByUserId: adminId,
      updatedByUserId: adminId,
      ...overrides,
    });

  beforeEach(async () => {
    tagRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(input => Object.assign(new StorytimeTagEntity(), input)),
      save: jest.fn(input => Promise.resolve(input)),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorytimeTagService,
        {
          provide: getRepositoryToken(StorytimeTagEntity),
          useValue: tagRepository,
        },
      ],
    }).compile();

    service = module.get<StorytimeTagService>(StorytimeTagService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('the vocabulary', () => {
    // A picker shows one shelf at a time, in the order an administrator
    // arranged it.
    it('lists tags by category and then by order', async () => {
      await service.findAll();

      expect(tagRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { category: 'ASC', displayOrder: 'ASC', name: 'ASC' },
      });
    });

    it('lists one category when asked', async () => {
      await service.findAll(StorytimeTagCategory.GENRE);

      expect(tagRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: StorytimeTagCategory.GENRE },
        }),
      );
    });

    it('finds several tags at once', async () => {
      await service.findByIds([tagId, 'tag-2']);

      expect(tagRepository.find).toHaveBeenCalled();
    });

    it('asks for nothing when given no identifiers', async () => {
      await expect(service.findByIds([])).resolves.toEqual([]);
      expect(tagRepository.find).not.toHaveBeenCalled();
    });

    it('reads one tag', async () => {
      tagRepository.findOne.mockResolvedValue(buildTag());

      await expect(service.findOneOrFail(tagId)).resolves.toBeDefined();
    });

    it('reports a tag that is not there', async () => {
      await expect(service.findOneOrFail(tagId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('adding a tag', () => {
    it('builds the slug from the name', async () => {
      const created = await service.create(
        { name: 'Content Warning', category: StorytimeTagCategory.THEME },
        adminId,
      );

      expect(created.slug).toBe('content-warning');
    });

    it('uses the slug an administrator typed', async () => {
      const created = await service.create(
        {
          name: 'Klingon',
          category: StorytimeTagCategory.FACTION,
          slug: 'klingon-empire',
        },
        adminId,
      );

      expect(created.slug).toBe('klingon-empire');
    });

    // Two tags meaning the same thing is exactly what an administrator-managed
    // vocabulary exists to prevent.
    it('refuses a slug another tag already holds', async () => {
      tagRepository.findOne.mockResolvedValue(buildTag());

      await expect(
        service.create(
          { name: 'Klingon', category: StorytimeTagCategory.FACTION },
          adminId,
        ),
      ).rejects.toThrow(/already exists/);
    });

    it('records who added it', async () => {
      const created = await service.create(
        { name: 'Klingon', category: StorytimeTagCategory.FACTION },
        adminId,
      );

      expect(created.createdByUserId).toBe(adminId);
      expect(created.isAdminManaged).toBe(true);
    });
  });

  describe('changing a tag', () => {
    beforeEach(() => {
      tagRepository.findOne.mockResolvedValue(buildTag());
    });

    it('renames it', async () => {
      const updated = await service.update(
        tagId,
        { name: 'Klingon Empire' },
        adminId,
      );

      expect(updated.name).toBe('Klingon Empire');
      expect(updated.updatedByUserId).toBe(adminId);
    });

    // A tag's address turns up in filter links people have shared, so a rename
    // leaves it alone unless somebody asks.
    it('leaves the slug alone when only the name changes', async () => {
      const updated = await service.update(
        tagId,
        { name: 'Klingon Empire' },
        adminId,
      );

      expect(updated.slug).toBe('klingon');
    });

    it('changes the slug when asked', async () => {
      tagRepository.findOne
        .mockResolvedValueOnce(buildTag())
        .mockResolvedValueOnce(null);

      const updated = await service.update(
        tagId,
        { slug: 'Klingon Empire' },
        adminId,
      );

      expect(updated.slug).toBe('klingon-empire');
    });

    it('refuses a slug another tag holds', async () => {
      tagRepository.findOne
        .mockResolvedValueOnce(buildTag())
        .mockResolvedValueOnce(buildTag({ id: 'tag-2' }));

      await expect(
        service.update(tagId, { slug: 'taken' }, adminId),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets a tag keep its own slug', async () => {
      tagRepository.findOne.mockResolvedValue(buildTag());

      await expect(
        service.update(tagId, { slug: 'klingon' }, adminId),
      ).resolves.toBeDefined();
    });

    it('clears the description when it is emptied', async () => {
      tagRepository.findOne.mockResolvedValue(
        buildTag({ description: 'The Empire.' }),
      );

      const updated = await service.update(
        tagId,
        { description: null },
        adminId,
      );

      expect(updated.description).toBeNull();
    });

    it('leaves anything not sent alone', async () => {
      const updated = await service.update(tagId, {}, adminId);

      expect(updated.name).toBe('Klingon');
      expect(updated.category).toBe(StorytimeTagCategory.FACTION);
    });

    it('moves it to another category', async () => {
      const updated = await service.update(
        tagId,
        { category: StorytimeTagCategory.SPECIES, displayOrder: 3 },
        adminId,
      );

      expect(updated.category).toBe(StorytimeTagCategory.SPECIES);
      expect(updated.displayOrder).toBe(3);
    });
  });

  describe('removing a tag', () => {
    // The join rows go with it by foreign key: a tag nobody should use again
    // must stop appearing on the Stories that used it.
    it('deletes it', async () => {
      tagRepository.findOne.mockResolvedValue(buildTag());

      await service.remove(tagId, adminId);

      expect(tagRepository.softDelete).toHaveBeenCalledWith(tagId);
    });

    it('reports a tag that is not there', async () => {
      await expect(service.remove(tagId, adminId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
