import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { coverUrlsOf } from 'src/shared/constants/image.constants';

import { NewsPostEntity } from './entities/news-post.entity';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

/** A post with a cover, and one without. */
const covered = { id: 'p1', coverImageId: 'cover-1' } as NewsPostEntity;
const bare = { id: 'p2', coverImageId: null } as NewsPostEntity;

describe('NewsController', () => {
  let controller: NewsController;
  let service: jest.Mocked<NewsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NewsController],
      providers: [
        {
          provide: NewsService,
          useValue: {
            findPublished: jest.fn(),
            findAllForAdmin: jest.fn(),
            findOneById: jest.fn(),
            findPublishedBySlug: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            publish: jest.fn(),
            remove: jest.fn(),
            setCover: jest.fn(),
            clearCover: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<NewsController>(NewsController);
    service = module.get(NewsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates public listing, with each post’s cover addresses', async () => {
    service.findPublished.mockResolvedValue({
      items: [covered, bare],
      total: 2,
      page: 1,
      pageSize: 10,
    });

    const page = await controller.findPublished({ page: 1 });

    expect(service.findPublished).toHaveBeenCalledWith({ page: 1 });
    expect(page.total).toBe(2);
    expect(page.items.map(post => post.coverImageUrls)).toEqual([
      coverUrlsOf('cover-1'),
      null,
    ]);
  });

  it('delegates admin listing, with each post’s cover addresses', async () => {
    service.findAllForAdmin.mockResolvedValue({
      items: [covered],
      total: 1,
      page: 1,
      pageSize: 5,
    });

    const page = await controller.findAllForAdmin({});

    expect(service.findAllForAdmin).toHaveBeenCalledWith({});
    expect(page.items[0].coverImageUrls).toEqual(coverUrlsOf('cover-1'));
  });

  it('delegates slug lookup, keeping the neighbours', async () => {
    service.findPublishedBySlug.mockResolvedValue({
      ...covered,
      previous: null,
      next: { slug: 'newer', title: 'Newer' },
    });

    const post = await controller.findOneBySlug('slug');

    expect(service.findPublishedBySlug).toHaveBeenCalledWith('slug');
    expect(post.next).toEqual({ slug: 'newer', title: 'Newer' });
    expect(post.coverImageUrls).toEqual(coverUrlsOf('cover-1'));
  });

  it('delegates admin id lookup', async () => {
    service.findOneById.mockResolvedValue(bare);

    await expect(controller.findOneForAdmin('id')).resolves.toEqual({
      ...bare,
      coverImageUrls: null,
    });
    expect(service.findOneById).toHaveBeenCalledWith('id');
  });

  it('delegates create with author id', async () => {
    const dto = { title: 'T', body: 'b' };
    service.create.mockResolvedValue(bare);

    await controller.create('author-1', dto);

    expect(service.create).toHaveBeenCalledWith(dto, 'author-1');
  });

  it('delegates update', async () => {
    service.update.mockResolvedValue(covered);

    const post = await controller.update('id', { title: 'X' });

    expect(service.update).toHaveBeenCalledWith('id', { title: 'X' });
    expect(post.coverImageUrls).toEqual(coverUrlsOf('cover-1'));
  });

  it('delegates publish', async () => {
    service.publish.mockResolvedValue(bare);

    await controller.publish('id');

    expect(service.publish).toHaveBeenCalledWith('id');
  });

  it('delegates remove', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('id');

    expect(service.remove).toHaveBeenCalledWith('id');
  });

  it('sends a described cover to be scanned', async () => {
    const file = { originalname: 'cover.png' } as Express.Multer.File;
    const accepted = { assetId: 'asset-1', status: 'AWAITING_SCAN' } as Awaited<
      ReturnType<NewsService['setCover']>
    >;
    service.setCover.mockResolvedValue(accepted);

    await expect(
      controller.setCover('id', 'admin-1', file, { altText: 'A shipyard' }),
    ).resolves.toBe(accepted);
    expect(service.setCover).toHaveBeenCalledWith('id', {
      userId: 'admin-1',
      altText: 'A shipyard',
      file,
    });
  });

  it('refuses a cover upload with no file', () => {
    expect(() =>
      controller.setCover('id', 'admin-1', undefined, { altText: 'A' }),
    ).toThrow(BadRequestException);
    expect(service.setCover).not.toHaveBeenCalled();
  });

  it('delegates cover removal', async () => {
    service.clearCover.mockResolvedValue(undefined);

    await controller.clearCover('id');

    expect(service.clearCover).toHaveBeenCalledWith('id');
  });
});
