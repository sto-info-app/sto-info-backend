import { Test, TestingModule } from '@nestjs/testing';

import { MediaProvider } from '../enums/media-provider.enum';
import { StorytimeChapterMediaEntity } from './entities/storytime-chapter-media.entity';
import { StorytimeMediaMapper } from './storytime-media.mapper';

describe('StorytimeMediaMapper', () => {
  let mapper: StorytimeMediaMapper;

  /**
   * Builds a stored video.
   *
   * @param overrides - Fields to change.
   * @returns The media entity.
   */
  const buildMedia = (
    overrides: Partial<StorytimeChapterMediaEntity> = {},
  ): StorytimeChapterMediaEntity =>
    Object.assign(new StorytimeChapterMediaEntity(), {
      id: 'media-1',
      chapterId: 'chapter-1',
      provider: MediaProvider.YOUTUBE,
      externalId: 'dQw4w9WgXcQ',
      playlistId: null,
      startSeconds: null,
      endSeconds: null,
      title: 'The escape',
      caption: 'Shot on Risa.',
      orderIndex: 1000,
      isPrimary: true,
      createdByUserId: 'user-1',
      ...overrides,
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorytimeMediaMapper],
    }).compile();

    mapper = module.get<StorytimeMediaMapper>(StorytimeMediaMapper);
  });

  it('is defined', () => {
    expect(mapper).toBeDefined();
  });

  it('maps what a reader is shown', () => {
    const dto = mapper.toDto(buildMedia());

    expect(dto.title).toBe('The escape');
    expect(dto.caption).toBe('Shot on Risa.');
    expect(dto.isPrimary).toBe(true);
  });

  // Built by the server rather than stored, so nothing a creator typed ever
  // reaches a reader's browser as a URL.
  it('sends a built embed URL and thumbnail', () => {
    const dto = mapper.toDto(buildMedia());

    expect(dto.embedUrl).toContain('youtube-nocookie.com');
    expect(dto.thumbnailUrl).toContain('dQw4w9WgXcQ');
    expect(dto.thumbnailHdUrl).toContain('maxresdefault');
  });

  it('withholds the bookkeeping', () => {
    const dto = mapper.toDto(buildMedia()) as unknown as Record<
      string,
      unknown
    >;

    expect(dto).not.toHaveProperty('createdByUserId');
    expect(dto).not.toHaveProperty('deletedAt');
  });

  it('maps a list', () => {
    expect(mapper.toDtoList([buildMedia()])).toHaveLength(1);
  });

  it('maps an empty list', () => {
    expect(mapper.toDtoList([])).toEqual([]);
  });
});
