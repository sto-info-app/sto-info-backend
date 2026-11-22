import { Logger } from '@nestjs/common';

import { jest } from '@jest/globals';
import { IsNull, Not, Repository } from 'typeorm';

import { FileAssetSlot } from 'src/file-assets/enums/file-asset-slot.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import {
  AssetAttachment,
  AssetPublisherRegistry,
} from 'src/file-assets/services/asset-publisher.registry';
import { NewsPostEntity } from 'src/news/entities/news-post.entity';

import { ScopeNewsCoverPublisher } from './scope-news-cover.publisher';

/**
 * Builds the attachment the publisher is handed.
 *
 * @param overrides - Whatever the case is actually about.
 * @returns The attachment.
 */
const attachment = (
  overrides: Partial<AssetAttachment> = {},
): AssetAttachment => ({
  subjectId: 'post-1',
  slot: FileAssetSlot.COVER,
  deliveryReference: 'new-cover',
  uploadedByUserId: 'user-1',
  detail: { altText: 'The fleet at dock' },
  ...overrides,
});

describe('ScopeNewsCoverPublisher', () => {
  let findOne: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let save: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let register: jest.Mock;
  let publisher: ScopeNewsCoverPublisher;

  beforeEach(() => {
    findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    save = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockImplementation(row => Promise.resolve(row));
    register = jest.fn();
    publisher = new ScopeNewsCoverPublisher(
      { findOne, save } as unknown as Repository<NewsPostEntity>,
      { register } as unknown as AssetPublisherRegistry,
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes for news posts, and says so to the registry', () => {
    publisher.onModuleInit();

    expect(publisher.subject).toBe(FileAssetSubject.NEWS_POST);
    expect(register).toHaveBeenCalledWith(publisher);
  });

  it('writes the cover and its description together, handing back the old one', async () => {
    findOne.mockResolvedValue({
      id: 'post-1',
      coverImageId: 'old-cover',
      coverImageAlt: 'Old',
    });

    await expect(publisher.attach(attachment())).resolves.toBe('old-cover');

    expect(findOne).toHaveBeenCalledWith({
      where: { id: 'post-1', communityId: Not(IsNull()) },
    });
    expect(save).toHaveBeenCalledWith({
      id: 'post-1',
      coverImageId: 'new-cover',
      coverImageAlt: 'The fleet at dock',
    });
  });

  it('hands the new cover back when its post has gone, so it is withdrawn', async () => {
    findOne.mockResolvedValue(null);

    await expect(publisher.attach(attachment())).resolves.toBe('new-cover');
    expect(save).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('writes nothing for a slot a post does not have', async () => {
    await expect(
      publisher.attach(attachment({ slot: FileAssetSlot.BANNER })),
    ).resolves.toBe('new-cover');
    expect(findOne).not.toHaveBeenCalled();
  });
});
