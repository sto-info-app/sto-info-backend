import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

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

  it('delegates public listing', () => {
    controller.findPublished({ page: 1 });
    expect(service.findPublished).toHaveBeenCalledWith({ page: 1 });
  });

  it('delegates admin listing', () => {
    controller.findAllForAdmin({});
    expect(service.findAllForAdmin).toHaveBeenCalledWith({});
  });

  it('delegates slug lookup', () => {
    controller.findOneBySlug('slug');
    expect(service.findPublishedBySlug).toHaveBeenCalledWith('slug');
  });

  it('delegates admin id lookup', () => {
    controller.findOneForAdmin('id');
    expect(service.findOneById).toHaveBeenCalledWith('id');
  });

  it('delegates create with author id', () => {
    const dto = { title: 'T', body: 'b' };
    controller.create('author-1', dto);
    expect(service.create).toHaveBeenCalledWith(dto, 'author-1');
  });

  it('delegates update', () => {
    controller.update('id', { title: 'X' });
    expect(service.update).toHaveBeenCalledWith('id', { title: 'X' });
  });

  it('delegates publish', () => {
    controller.publish('id');
    expect(service.publish).toHaveBeenCalledWith('id');
  });

  it('delegates remove', () => {
    controller.remove('id');
    expect(service.remove).toHaveBeenCalledWith('id');
  });
});
