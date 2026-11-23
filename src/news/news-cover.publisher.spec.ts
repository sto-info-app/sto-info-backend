import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { IsNull, Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';

import { NewsPostEntity } from './entities/news-post.entity';
import { NewsCoverPublisher } from './news-cover.publisher';

/**
 * Builds the attachment the publisher is handed.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The attachment.
 */
const cleared = (
  overrides: Partial<AssetAttachment> = {},
): AssetAttachment => ({
  subjectId: 'site-post',
  slot: FileAssetSlot.COVER,
  deliveryReference: 'cleared-cover',
  uploadedByUserId: 'admin-1',
  detail: { altText: 'The release notes banner' },
  ...overrides,
});

describe('NewsCoverPublisher', () => {
  let findOneBy: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let save: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let register: jest.Mock;
  let publisher: NewsCoverPublisher;

  beforeEach(() => {
    findOneBy = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    save = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockImplementation(row => Promise.resolve(row));
    register = jest.fn();
    publisher = new NewsCoverPublisher(
      { findOneBy, save } as unknown as Repository<NewsPostEntity>,
      { register } as unknown as AssetPublisherRegistry,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers for the site’s own posts, not the scoped ones', () => {
    publisher.onModuleInit();

    expect(publisher.subject).toBe(FileAssetSubject.SITE_NEWS_POST);
    expect(register).toHaveBeenCalledWith(publisher);
  });

  it('writes the cover with its description, and hands back the one it replaced', async () => {
    findOneBy.mockResolvedValue({
      id: 'site-post',
      coverImageId: 'earlier-cover',
      coverImageAlt: 'Earlier',
    });

    await expect(publisher.attach(cleared())).resolves.toBe('earlier-cover');

    expect(findOneBy).toHaveBeenCalledWith({
      id: 'site-post',
      communityId: IsNull(),
    });
    expect(save).toHaveBeenCalledWith({
      id: 'site-post',
      coverImageId: 'cleared-cover',
      coverImageAlt: 'The release notes banner',
    });
  });

  it('hands back null when the post had no cover before', async () => {
    findOneBy.mockResolvedValue({
      id: 'site-post',
      coverImageId: null,
      coverImageAlt: null,
    });

    await expect(publisher.attach(cleared())).resolves.toBeNull();
  });

  it('hands the cover back to be withdrawn when its post has gone', async () => {
    findOneBy.mockResolvedValue(null);

    await expect(publisher.attach(cleared())).resolves.toBe('cleared-cover');
    expect(save).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('no such post'),
    );
  });

  it('reads nothing for a slot a post does not have', async () => {
    await expect(
      publisher.attach(cleared({ slot: FileAssetSlot.BANNER })),
    ).resolves.toBe('cleared-cover');
    expect(findOneBy).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a cover'),
    );
  });
});
