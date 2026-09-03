import { Test, TestingModule } from '@nestjs/testing';

import { AccessControlService } from '../../access-control/access-control.service';
import { MediaProvider } from '../enums/media-provider.enum';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';
import { StorytimeMediaController } from './storytime-media.controller';
import { StorytimeMediaMapper } from './storytime-media.mapper';
import { StorytimeMediaService } from './storytime-media.service';

describe('StorytimeMediaController', () => {
  let controller: StorytimeMediaController;
  let mediaService: {
    add: jest.Mock;
    findByChapter: jest.Mock;
    update: jest.Mock;
    reorder: jest.Mock;
    remove: jest.Mock;
  };

  const userId = 'user-1';
  const chapterId = 'chapter-1';
  const mediaId = 'media-1';

  const media = Object.assign(new StorytimeChapterMediaEntity(), {
    id: mediaId,
    chapterId,
    provider: MediaProvider.YOUTUBE,
    externalId: 'dQw4w9WgXcQ',
    playlistId: null,
    startSeconds: null,
    endSeconds: null,
    title: null,
    caption: null,
    orderIndex: 1000,
    isPrimary: false,
  });

  beforeEach(async () => {
    mediaService = {
      add: jest.fn().mockResolvedValue(media),
      findByChapter: jest.fn().mockResolvedValue([media]),
      update: jest.fn().mockResolvedValue(media),
      reorder: jest.fn().mockResolvedValue([media]),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorytimeMediaController],
      providers: [
        { provide: StorytimeMediaService, useValue: mediaService },
        StorytimeMediaMapper,
        { provide: AccessControlService, useValue: { can: jest.fn() } },
      ],
    }).compile();

    controller = module.get<StorytimeMediaController>(StorytimeMediaController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('adds a video and returns it ready to embed', async () => {
    const result = await controller.add(
      chapterId,
      { url: 'https://youtu.be/dQw4w9WgXcQ' },
      userId,
    );

    expect(result.embedUrl).toContain('youtube-nocookie.com');
    expect(mediaService.add).toHaveBeenCalledWith(
      chapterId,
      { url: 'https://youtu.be/dQw4w9WgXcQ' },
      userId,
    );
  });

  it('lists a Chapter’s videos', async () => {
    const result = await controller.findByChapter(chapterId);

    expect(result).toHaveLength(1);
    expect(mediaService.findByChapter).toHaveBeenCalledWith(chapterId);
  });

  it('changes a video', async () => {
    await controller.update(mediaId, { title: 'Renamed' }, userId);

    expect(mediaService.update).toHaveBeenCalledWith(
      mediaId,
      { title: 'Renamed' },
      userId,
    );
  });

  it('reorders a Chapter’s videos', async () => {
    await controller.reorder(chapterId, { mediaIds: ['b', 'a'] }, userId);

    expect(mediaService.reorder).toHaveBeenCalledWith(
      chapterId,
      ['b', 'a'],
      userId,
    );
  });

  it('removes a video', async () => {
    await controller.remove(mediaId, userId);

    expect(mediaService.remove).toHaveBeenCalledWith(mediaId, userId);
  });
});
